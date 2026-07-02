#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE=${1:?image URI required}
AWS_REGION=${2:?AWS region required}
ENV_PARAMETER=${3:-/metaverse/prod/env}
ALERTER_IMAGE=${4:-}
APP_DIR=${APP_DIR:-/opt/metaverse}
COMPOSE_FILE=$APP_DIR/docker-compose.prod.yml
ENV_FILE=$APP_DIR/.env
PREVIOUS_IMAGE=""
IMAGE_HISTORY_FILE=$APP_DIR/.backend-images
TELEGRAM_API_BASE=${TELEGRAM_API_BASE:-https://api.telegram.org}
SKIP_SSM_ENV=${SKIP_SSM_ENV:-0}
SKIP_ECR_LOGIN=${SKIP_ECR_LOGIN:-0}
SKIP_PULL=${SKIP_PULL:-0}
SKIP_ALERTER=${SKIP_ALERTER:-0}

cd "$APP_DIR"

send_alert() {
  local message=$1
  echo "$message" >&2
  if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    echo "WARNING: TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set; skipping Telegram alert" >&2
    return 0
  fi
  curl --silent --show-error --max-time 10 \
    --request POST "${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${message}" \
    >/dev/null || echo "WARNING: Telegram alert POST failed" >&2
}

if [[ "$SKIP_SSM_ENV" != "1" ]]; then
  aws ssm get-parameter \
    --region "$AWS_REGION" \
    --name "$ENV_PARAMETER" \
    --with-decryption \
    --query Parameter.Value \
    --output text > .env.next
  chmod 600 .env.next
  mv .env.next "$ENV_FILE"
fi

# Load TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID (and everything else) from the env
# file into this shell so send_alert can reach Telegram without re-parsing it.
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f .backend-image ]]; then PREVIOUS_IMAGE=$(<.backend-image); fi
REGISTRY=${IMAGE%%/*}
IMAGE_REPOSITORY=${IMAGE%:*}

if [[ "$SKIP_ECR_LOGIN" != "1" ]]; then
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"
fi

update_image_history() {
  {
    printf '%s\n' "$IMAGE"
    [[ -f "$IMAGE_HISTORY_FILE" ]] && cat "$IMAGE_HISTORY_FILE"
    [[ -n "$PREVIOUS_IMAGE" ]] && printf '%s\n' "$PREVIOUS_IMAGE"
    docker image ls --format '{{.Repository}}:{{.Tag}}' | while IFS= read -r local_image; do
      if [[ "$local_image" == "$IMAGE_REPOSITORY":* ]]; then
        printf '%s\n' "$local_image"
      fi
    done
  } | awk 'NF && !seen[$0]++ && ++count <= 3' > "$IMAGE_HISTORY_FILE.next"
  chmod 600 "$IMAGE_HISTORY_FILE.next"
  mv "$IMAGE_HISTORY_FILE.next" "$IMAGE_HISTORY_FILE"
}

prune_local_release_images() {
  while IFS= read -r local_image; do
    [[ "$local_image" == "$IMAGE_REPOSITORY":* ]] || continue
    if ! grep -Fqx "$local_image" "$IMAGE_HISTORY_FILE"; then
      docker image rm "$local_image" || true
    fi
  done < <(docker image ls --format '{{.Repository}}:{{.Tag}}')
  docker image prune -f
}

export BACKEND_IMAGE=$IMAGE
if [[ "$SKIP_PULL" != "1" ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend setup
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis livekit

SETUP_LOG=$(mktemp)
# Capture the setup container's real exit code (not tee's) via PIPESTATUS.
# The `|| setup_rc=...` keeps `set -e` from aborting before we can alert.
setup_rc=0
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm setup 2>&1 | tee "$SETUP_LOG" || setup_rc=${PIPESTATUS[0]}
if [[ "$setup_rc" -ne 0 ]]; then
  send_alert "$(printf '🔴 Deploy aborted on %s: setup (migrate+seed) container exited %s for %s.\nLast logs:\n%s' \
    "$(hostname)" "$setup_rc" "$IMAGE" "$(tail -n 50 "$SETUP_LOG")")"
  rm -f "$SETUP_LOG"
  exit "$setup_rc"
fi
rm -f "$SETUP_LOG"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps backend

healthy=false
for _ in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3001/health/ready | grep -q '"ok":true'; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  BACKEND_LOG=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 backend 2>&1)
  echo "$BACKEND_LOG"
  if [[ -n "$PREVIOUS_IMAGE" ]]; then
    echo "New release failed; rolling back to $PREVIOUS_IMAGE" >&2
    export BACKEND_IMAGE=$PREVIOUS_IMAGE
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps backend
    send_alert "$(printf '🟠 Deploy rolled back on %s: %s failed its health check and was reverted to %s.\nLast backend logs:\n%s' \
      "$(hostname)" "$IMAGE" "$PREVIOUS_IMAGE" "$(tail -n 50 <<<"$BACKEND_LOG")")"
  else
    send_alert "$(printf '🔴 Deploy failed on %s: %s did not become healthy and there is no previous image to roll back to.\nLast backend logs:\n%s' \
      "$(hostname)" "$IMAGE" "$(tail -n 50 <<<"$BACKEND_LOG")")"
  fi
  exit 1
fi

printf '%s\n' "$IMAGE" > .backend-image
update_image_history
prune_local_release_images
echo "Retained release images: $(paste -sd ', ' "$IMAGE_HISTORY_FILE")"
echo "Deployed $IMAGE"

if [[ "$SKIP_ALERTER" != "1" && -n "$ALERTER_IMAGE" ]]; then
  export ALERTER_IMAGE
  if [[ "$SKIP_PULL" != "1" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull alerter || echo "WARNING: alerter pull failed" >&2
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps alerter || echo "WARNING: alerter failed to start" >&2
fi

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
  # --fail-with-body makes non-2xx responses exit non-zero (body kept for
  # diagnosis); --retry 1 retries once on transient failures. The request URL
  # contains the bot token, so it is never echoed — only the response body is.
  local response
  if ! response=$(curl --silent --fail-with-body --max-time 10 --retry 1 \
    --request POST "${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${message}" 2>/dev/null); then
    echo "WARNING: Telegram alert POST failed (response: ${response:-<none>})" >&2
  fi
}

# Trim a log excerpt for embedding in a Telegram alert: keep the last $1 lines,
# then hard-cap the character count so the surrounding message stays under
# Telegram's 4096-char limit (mirrors the alerter's own MAX_LEN headroom).
TELEGRAM_LOG_MAXLEN=${TELEGRAM_LOG_MAXLEN:-3000}
clip_logs() {
  local lines=$1 out
  out=$(tail -n "$lines")
  if (( ${#out} > TELEGRAM_LOG_MAXLEN )); then
    out="…${out: -TELEGRAM_LOG_MAXLEN}"
  fi
  printf '%s' "$out"
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

# The alerter container mounts /var/run/docker.sock; grant its container the
# socket's group (via group_add in the compose file) so its /events
# subscription isn't denied with EACCES. Derive the gid from the socket on THIS
# box — the most robust source — and export it for compose interpolation, with
# a 109 fallback (the common Debian/Ubuntu `docker` group) if it can't be read.
DOCKER_SOCK=${DOCKER_SOCK:-/var/run/docker.sock}
if [[ -e "$DOCKER_SOCK" ]]; then
  DOCKER_GID=$(stat -c '%g' "$DOCKER_SOCK" 2>/dev/null || echo 109)
else
  DOCKER_GID=109
fi
export DOCKER_GID
echo "Alerter docker socket group: ${DOCKER_GID} (from ${DOCKER_SOCK})"

export BACKEND_IMAGE=$IMAGE
if [[ "$SKIP_PULL" != "1" ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend setup
fi
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis livekit

# --- Gate 1: watchdog alerter (FIRST — before touching the release) --------
# The alerter is independent of the backend image. It must be pulled, started,
# and report HEALTHY before anything about the release changes: if alerting
# cannot come up, we do not deploy at all, and the previous release stays both
# serving and recorded. "Healthy" is the container's HEALTHCHECK, which passes
# only after index.mjs has delivered its startup Telegram announcement and
# established the Docker events subscription (or entered no-token idle mode).
deploy_alerter() {
  if [[ "$SKIP_PULL" != "1" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull alerter || return 1
  fi
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps alerter || return 1
  local deadline=$((SECONDS + ${ALERTER_HEALTH_TIMEOUT:-60}))
  local cid status
  while (( SECONDS < deadline )); do
    cid=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" ps --quiet alerter)
    if [[ -n "$cid" ]]; then
      status=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)
      if [[ "$status" == "healthy" ]]; then
        return 0
      fi
    fi
    sleep 2
  done
  return 1
}

if [[ "$SKIP_ALERTER" != "1" && -n "$ALERTER_IMAGE" ]]; then
  export ALERTER_IMAGE
  if ! deploy_alerter; then
    ALERTER_LOG=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=50 alerter 2>&1 || true)
    echo "$ALERTER_LOG"
    send_alert "$(printf '🔴 Deploy aborted on %s: watchdog alerter (%s) failed to become healthy; not deploying %s. Previous release untouched.\nLast alerter logs:\n%s' \
      "$(hostname)" "$ALERTER_IMAGE" "$IMAGE" "$(clip_logs 10 <<<"$ALERTER_LOG")")"
    exit 1
  fi
  echo "Alerter watchdog healthy"
fi

# --- Gate 2: migrate + seed ------------------------------------------------
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
      "$(hostname)" "$IMAGE" "$PREVIOUS_IMAGE" "$(clip_logs 50 <<<"$BACKEND_LOG")")"
  else
    send_alert "$(printf '🔴 Deploy failed on %s: %s did not become healthy and there is no previous image to roll back to.\nLast backend logs:\n%s' \
      "$(hostname)" "$IMAGE" "$(clip_logs 50 <<<"$BACKEND_LOG")")"
  fi
  exit 1
fi

# Only a fully healthy deploy is recorded: any earlier gate failure exits
# before this point, leaving the previous release both serving AND recorded.
printf '%s\n' "$IMAGE" > .backend-image
update_image_history
prune_local_release_images
echo "Retained release images: $(paste -sd ', ' "$IMAGE_HISTORY_FILE")"
echo "Deployed $IMAGE"

#!/usr/bin/env bash
set -Eeuo pipefail

IMAGE=${1:?image URI required}
AWS_REGION=${2:?AWS region required}
ENV_PARAMETER=${3:-/metaverse/prod/env}
APP_DIR=/opt/metaverse
COMPOSE_FILE=$APP_DIR/docker-compose.prod.yml
ENV_FILE=$APP_DIR/.env
PREVIOUS_IMAGE=""
IMAGE_HISTORY_FILE=$APP_DIR/.backend-images

cd "$APP_DIR"
aws ssm get-parameter \
  --region "$AWS_REGION" \
  --name "$ENV_PARAMETER" \
  --with-decryption \
  --query Parameter.Value \
  --output text > .env.next
chmod 600 .env.next
mv .env.next "$ENV_FILE"

if [[ -f .backend-image ]]; then PREVIOUS_IMAGE=$(<.backend-image); fi
REGISTRY=${IMAGE%%/*}
IMAGE_REPOSITORY=${IMAGE%:*}
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

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
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull backend setup
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres redis livekit
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm setup
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps backend

healthy=false
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:3001/health/ready | grep -q '"ok":true'; then
    healthy=true
    break
  fi
  sleep 2
done

if [[ "$healthy" != true ]]; then
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" logs --tail=100 backend
  if [[ -n "$PREVIOUS_IMAGE" ]]; then
    echo "New release failed; rolling back to $PREVIOUS_IMAGE" >&2
    export BACKEND_IMAGE=$PREVIOUS_IMAGE
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --no-deps backend
  fi
  exit 1
fi

printf '%s\n' "$IMAGE" > .backend-image
update_image_history
prune_local_release_images
echo "Retained release images: $(paste -sd ', ' "$IMAGE_HISTORY_FILE")"
echo "Deployed $IMAGE"

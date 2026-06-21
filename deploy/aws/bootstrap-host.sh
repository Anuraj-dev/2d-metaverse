#!/usr/bin/env bash
set -Eeuo pipefail

if command -v dnf >/dev/null 2>&1; then
  dnf install -y docker nginx certbot python3-certbot-nginx
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl docker.io docker-compose-v2 nginx certbot python3-certbot-nginx
else
  echo "Unsupported Linux distribution" >&2
  exit 1
fi

systemctl enable --now docker
systemctl enable --now nginx
mkdir -p /opt/metaverse
chmod 700 /opt/metaverse
docker version
docker compose version

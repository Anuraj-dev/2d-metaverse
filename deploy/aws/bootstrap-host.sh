#!/usr/bin/env bash
set -Eeuo pipefail

if command -v dnf >/dev/null 2>&1; then
  dnf install -y docker nginx certbot python3-certbot-nginx unzip
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl docker.io docker-compose-v2 nginx certbot python3-certbot-nginx unzip
else
  echo "Unsupported Linux distribution" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscliv2.zip
  rm -rf /tmp/aws-cli-install
  unzip -q /tmp/awscliv2.zip -d /tmp/aws-cli-install
  /tmp/aws-cli-install/aws/install
fi

systemctl enable --now docker
systemctl enable --now nginx
mkdir -p /opt/metaverse
chmod 700 /opt/metaverse
docker version
docker compose version
aws --version

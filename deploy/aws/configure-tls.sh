#!/usr/bin/env bash
set -Eeuo pipefail

EMAIL=${1:?Certificate email required}
API_DOMAIN=${2:?API domain required}
LIVEKIT_DOMAIN=${3:?LiveKit domain required}
TURN_DOMAIN=${4:?TURN domain required}
NGINX_SOURCE=${5:-/tmp/metaverse-nginx.conf}

for value in "$API_DOMAIN" "$LIVEKIT_DOMAIN" "$TURN_DOMAIN"; do
  [[ "$value" =~ ^[a-z0-9.-]+$ ]] || { echo "Invalid domain: $value" >&2; exit 1; }
done

systemctl stop nginx
trap 'systemctl start nginx' EXIT
for domain in "$API_DOMAIN" "$LIVEKIT_DOMAIN" "$TURN_DOMAIN"; do
  certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --cert-name "$domain" \
    --domain "$domain" \
    --keep-until-expiring
done
trap - EXIT

sed \
  -e "s/API_DOMAIN/$API_DOMAIN/g" \
  -e "s/LIVEKIT_DOMAIN/$LIVEKIT_DOMAIN/g" \
  "$NGINX_SOURCE" > /etc/nginx/sites-available/metaverse
ln -sfn /etc/nginx/sites-available/metaverse /etc/nginx/sites-enabled/metaverse
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

install -d -m 755 /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl stop nginx\n' > /etc/letsencrypt/renewal-hooks/pre/10-stop-nginx
printf '#!/bin/sh\nsystemctl start nginx\n' > /etc/letsencrypt/renewal-hooks/post/90-start-nginx
cat > /etc/letsencrypt/renewal-hooks/deploy/50-reload-metaverse <<'EOF'
#!/bin/sh
systemctl reload nginx
if [ -f /opt/metaverse/docker-compose.prod.yml ] && [ -f /opt/metaverse/.backend-image ]; then
  cd /opt/metaverse
  export BACKEND_IMAGE="$(cat .backend-image)"
  docker compose --env-file .env -f docker-compose.prod.yml restart livekit
fi
EOF
chmod 755 /etc/letsencrypt/renewal-hooks/pre/10-stop-nginx \
  /etc/letsencrypt/renewal-hooks/post/90-start-nginx \
  /etc/letsencrypt/renewal-hooks/deploy/50-reload-metaverse

certbot certificates

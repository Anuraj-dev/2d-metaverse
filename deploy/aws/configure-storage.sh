#!/usr/bin/env bash
set -Eeuo pipefail

VOLUME_ID=${1:?EBS volume ID required}
SERIAL=${VOLUME_ID//-/}
MOUNT_POINT=/srv/metaverse-data

DEVICE=""
for _ in $(seq 1 30); do
  DEVICE_NAME=$(lsblk -ndo NAME,SERIAL,TYPE | awk -v serial="$SERIAL" '$2 == serial && $3 == "disk" {print $1; exit}')
  if [[ -n "$DEVICE_NAME" ]]; then
    DEVICE="/dev/$DEVICE_NAME"
    break
  fi
  sleep 2
done
[[ -b "$DEVICE" ]] || { echo "Attached volume $VOLUME_ID was not detected" >&2; exit 1; }

if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -L metaverse-data "$DEVICE"
fi

UUID=$(blkid -s UUID -o value "$DEVICE")
mkdir -p "$MOUNT_POINT"
if ! grep -q "UUID=$UUID" /etc/fstab; then
  printf 'UUID=%s %s ext4 defaults,nofail 0 2\n' "$UUID" "$MOUNT_POINT" >> /etc/fstab
fi
mountpoint -q "$MOUNT_POINT" || mount "$MOUNT_POINT"

systemctl stop docker
mkdir -p "$MOUNT_POINT/docker" "$MOUNT_POINT/app"
if [[ -d /var/lib/docker ]] && [[ -z "$(find "$MOUNT_POINT/docker" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  cp -a /var/lib/docker/. "$MOUNT_POINT/docker/"
fi
mkdir -p /etc/docker
printf '{\n  "data-root": "%s/docker"\n}\n' "$MOUNT_POINT" > /etc/docker/daemon.json

if [[ -d /opt/metaverse && ! -L /opt/metaverse ]]; then
  cp -a /opt/metaverse/. "$MOUNT_POINT/app/"
  rm -rf /opt/metaverse
fi
ln -sfn "$MOUNT_POINT/app" /opt/metaverse
chmod 700 "$MOUNT_POINT/app"

systemctl start docker
docker info --format 'docker_root={{.DockerRootDir}}'
findmnt "$MOUNT_POINT"

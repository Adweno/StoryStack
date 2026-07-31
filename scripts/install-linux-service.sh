#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${1:-/opt/story-stack}"
SERVICE_PATH="/etc/systemd/system/story-stack.service"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

mkdir -p /var/lib/story-stack
cp "$(dirname "$0")/story-stack.service" "$SERVICE_PATH"
sed -i "s#WorkingDirectory=/opt/story-stack#WorkingDirectory=${PROJECT_PATH}#g" "$SERVICE_PATH"

systemctl daemon-reload
systemctl enable story-stack

echo "Installed Story Stack. Start it with: sudo systemctl start story-stack"

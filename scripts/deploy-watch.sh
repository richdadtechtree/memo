#!/usr/bin/env bash
# cron 등으로 주기적으로 실행: origin에 새 커밋이 있으면 pull 받아 재배포한다.
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${DEPLOY_BRANCH:-main}"
PM2_NAME="${DEPLOY_PM2_NAME:-myreader}"

git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 새 커밋 발견 (${LOCAL:0:7} -> ${REMOTE:0:7}), 배포 시작"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
npm install
pm2 restart "$PM2_NAME"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 배포 완료"

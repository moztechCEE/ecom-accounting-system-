#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-moztech-main-db}"
INSTANCE_CONNECTION_NAME="${CLOUDSQL_INSTANCE:-moztech-main-db:asia-east1:moztech-main-db}"
LOCAL_PORT="${CLOUDSQL_PROXY_PORT:-5433}"

if ! command -v cloud-sql-proxy >/dev/null 2>&1; then
  cat <<'MSG' >&2
cloud-sql-proxy is not installed.

Install it first:
  brew install cloud-sql-proxy

Then login if needed:
  gcloud auth application-default login
MSG
  exit 1
fi

echo "Starting Cloud SQL Auth Proxy for ${INSTANCE_CONNECTION_NAME} on 127.0.0.1:${LOCAL_PORT}"
exec cloud-sql-proxy \
  --project="${PROJECT_ID}" \
  --address=127.0.0.1 \
  --port="${LOCAL_PORT}" \
  "${INSTANCE_CONNECTION_NAME}"

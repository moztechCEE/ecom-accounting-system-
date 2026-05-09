#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-$(gcloud config get-value run/region 2>/dev/null || true)}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-ecom-accounting-backend}"
API_VERSION="${GOOGLE_ADS_API_VERSION:-v21}"
DEFAULT_CURRENCY="${GOOGLE_ADS_DEFAULT_CURRENCY:-TWD}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is empty. Run: gcloud config set project <project-id>" >&2
  exit 1
fi

upsert_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    return
  fi
  if ! gcloud secrets describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${name}" \
      --project "${PROJECT_ID}" \
      --replication-policy="automatic"
  fi
  printf "%s" "${value}" | gcloud secrets versions add "${name}" \
    --project "${PROJECT_ID}" \
    --data-file=- >/dev/null
}

grant_secret_access() {
  local name="$1"
  local runtime_service_account="$2"
  if [[ -z "${runtime_service_account}" ]]; then
    return
  fi
  gcloud secrets add-iam-policy-binding "${name}" \
    --project "${PROJECT_ID}" \
    --member "serviceAccount:${runtime_service_account}" \
    --role "roles/secretmanager.secretAccessor" >/dev/null
}

echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE}"
echo "Region: ${REGION}"
echo
echo "Needed from Google Ads:"
echo "  - Developer token from Tools > Setup > API Center"
echo "  - OAuth client ID / client secret"
echo "  - OAuth refresh token with scope https://www.googleapis.com/auth/adwords"
echo "  - Google Ads customer ID, e.g. 6215621647"
echo

read -rsp "Paste Google Ads developer token (hidden): " GOOGLE_ADS_DEVELOPER_TOKEN
echo
read -rsp "Paste Google OAuth client ID (hidden): " GOOGLE_ADS_CLIENT_ID
echo
read -rsp "Paste Google OAuth client secret (hidden): " GOOGLE_ADS_CLIENT_SECRET
echo
read -rsp "Paste Google OAuth refresh token (hidden): " GOOGLE_ADS_REFRESH_TOKEN
echo
read -rp "Google Ads customer IDs, comma separated, e.g. 6215621647 (Enter to use screenshot ID): " GOOGLE_ADS_CUSTOMER_IDS
read -rp "Optional manager login customer ID, without dashes (Enter to skip): " GOOGLE_ADS_LOGIN_CUSTOMER_ID

GOOGLE_ADS_CUSTOMER_IDS="${GOOGLE_ADS_CUSTOMER_IDS:-6215621647}"

if [[ -z "${GOOGLE_ADS_DEVELOPER_TOKEN}" || -z "${GOOGLE_ADS_CLIENT_ID}" || -z "${GOOGLE_ADS_CLIENT_SECRET}" || -z "${GOOGLE_ADS_REFRESH_TOKEN}" ]]; then
  echo "One or more required credentials are empty; aborting." >&2
  exit 1
fi

upsert_secret GOOGLE_ADS_DEVELOPER_TOKEN "${GOOGLE_ADS_DEVELOPER_TOKEN}"
upsert_secret GOOGLE_ADS_CLIENT_ID "${GOOGLE_ADS_CLIENT_ID}"
upsert_secret GOOGLE_ADS_CLIENT_SECRET "${GOOGLE_ADS_CLIENT_SECRET}"
upsert_secret GOOGLE_ADS_REFRESH_TOKEN "${GOOGLE_ADS_REFRESH_TOKEN}"
unset GOOGLE_ADS_DEVELOPER_TOKEN GOOGLE_ADS_CLIENT_ID GOOGLE_ADS_CLIENT_SECRET GOOGLE_ADS_REFRESH_TOKEN

RUNTIME_SERVICE_ACCOUNT="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"

for secret_name in \
  GOOGLE_ADS_DEVELOPER_TOKEN \
  GOOGLE_ADS_CLIENT_ID \
  GOOGLE_ADS_CLIENT_SECRET \
  GOOGLE_ADS_REFRESH_TOKEN; do
  grant_secret_access "${secret_name}" "${RUNTIME_SERVICE_ACCOUNT}"
done

UPDATE_ENV_VARS="GOOGLE_ADS_API_VERSION=${API_VERSION},GOOGLE_ADS_DEFAULT_CURRENCY=${DEFAULT_CURRENCY},GOOGLE_ADS_CUSTOMER_IDS=${GOOGLE_ADS_CUSTOMER_IDS}"
if [[ -n "${GOOGLE_ADS_LOGIN_CUSTOMER_ID// }" ]]; then
  UPDATE_ENV_VARS="${UPDATE_ENV_VARS},GOOGLE_ADS_LOGIN_CUSTOMER_ID=${GOOGLE_ADS_LOGIN_CUSTOMER_ID}"
fi

gcloud run services update "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --update-secrets "GOOGLE_ADS_DEVELOPER_TOKEN=GOOGLE_ADS_DEVELOPER_TOKEN:latest,GOOGLE_ADS_CLIENT_ID=GOOGLE_ADS_CLIENT_ID:latest,GOOGLE_ADS_CLIENT_SECRET=GOOGLE_ADS_CLIENT_SECRET:latest,GOOGLE_ADS_REFRESH_TOKEN=GOOGLE_ADS_REFRESH_TOKEN:latest" \
  --update-env-vars "${UPDATE_ENV_VARS}"

echo
echo "Done. Next checks:"
echo "  GET /api/v1/integrations/google-ads/readiness"
echo "  GET /api/v1/integrations/google-ads/insights?since=2026-05-01&until=2026-05-09"

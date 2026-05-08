#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-$(gcloud config get-value run/region 2>/dev/null || true)}"
REGION="${REGION:-asia-east1}"
SERVICE="${SERVICE:-ecom-accounting-backend}"
SECRET_NAME="${SECRET_NAME:-META_ADS_ACCESS_TOKEN}"
API_VERSION="${META_ADS_API_VERSION:-v23.0}"
DEFAULT_CURRENCY="${META_ADS_DEFAULT_CURRENCY:-TWD}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID is empty. Run: gcloud config set project <project-id>" >&2
  exit 1
fi

echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE}"
echo "Region: ${REGION}"
echo
read -rsp "Paste Meta Ads access token (hidden): " META_ADS_ACCESS_TOKEN
echo

if [[ -z "${META_ADS_ACCESS_TOKEN}" ]]; then
  echo "Token is empty; aborting." >&2
  exit 1
fi

if ! gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud secrets create "${SECRET_NAME}" \
    --project "${PROJECT_ID}" \
    --replication-policy="automatic"
fi

printf "%s" "${META_ADS_ACCESS_TOKEN}" | gcloud secrets versions add "${SECRET_NAME}" \
  --project "${PROJECT_ID}" \
  --data-file=-
unset META_ADS_ACCESS_TOKEN

read -rp "Optional Meta Ad Account IDs, comma separated, e.g. act_123,act_456 (Enter to skip): " META_ADS_ACCOUNT_IDS

RUNTIME_SERVICE_ACCOUNT="$(gcloud run services describe "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format='value(spec.template.spec.serviceAccountName)' 2>/dev/null || true)"

if [[ -n "${RUNTIME_SERVICE_ACCOUNT}" ]]; then
  gcloud secrets add-iam-policy-binding "${SECRET_NAME}" \
    --project "${PROJECT_ID}" \
    --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
    --role "roles/secretmanager.secretAccessor" >/dev/null
fi

UPDATE_ENV_VARS="META_ADS_API_VERSION=${API_VERSION},META_ADS_DEFAULT_CURRENCY=${DEFAULT_CURRENCY}"
if [[ -n "${META_ADS_ACCOUNT_IDS// }" ]]; then
  UPDATE_ENV_VARS="${UPDATE_ENV_VARS},META_ADS_ACCOUNT_IDS=${META_ADS_ACCOUNT_IDS}"
fi

gcloud run services update "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --update-secrets "META_ADS_ACCESS_TOKEN=${SECRET_NAME}:latest" \
  --update-env-vars "${UPDATE_ENV_VARS}"

echo
echo "Done. Next check:"
echo "  GET /api/v1/integrations/meta-ads/readiness"

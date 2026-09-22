#!/usr/bin/env bash
set -euo pipefail
# DEV only. Build must already have succeeded; never uses production service names.
BUILD_ID="${1:?Pass the successful Cloud Build ID}"
PROJECT=moztech-main-db
REGION=asia-east1
ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
export BUILD_ID
read -r API_IMAGE WEB_IMAGE < <(python3 - <<'PY'
import subprocess, json, os
d=json.loads(subprocess.check_output(['gcloud','builds','describe',os.environ['BUILD_ID'],'--project=moztech-main-db','--format=json'],stderr=subprocess.DEVNULL))
assert d['status']=='SUCCESS', 'Build has not succeeded'
images=d['results']['images']
def image(service):
 matches=[x for x in images if x['name'].split('/')[-1].split(':')[0]==service]
 assert len(matches)==1
 return matches[0]['name'].rsplit(':',1)[0]+'@'+matches[0]['digest']
print(image('corely-erp-api-dev'),image('corely-erp-dev'))
PY
)
gcloud run deploy corely-erp-api-dev --project="$PROJECT" --region="$REGION" \
  --image="$API_IMAGE" --service-account="corely-erp-dev-rt@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances="$PROJECT:$REGION:moztech-main-db" \
  --env-vars-file="$ROOT_DIR/scripts/dev/backend.env.yaml" \
  --set-secrets=DB_PASSWORD=corely-erp-dev-db-password:1,JWT_SECRET=corely-erp-dev-jwt:1 \
  --port=3000 --memory=1Gi --cpu=1 --max-instances=2 --min-instances=0 \
  --concurrency=40 --timeout=300 --allow-unauthenticated --labels=environment=dev,application=corely-erp --quiet
API_ORIGIN="$(gcloud run services describe corely-erp-api-dev --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
gcloud run deploy corely-erp-dev --project="$PROJECT" --region="$REGION" \
  --image="$WEB_IMAGE" --service-account="corely-erp-dev-web@$PROJECT.iam.gserviceaccount.com" \
  --set-env-vars="API_URL=$API_ORIGIN/api/v1,WS_URL=$API_ORIGIN,DEFAULT_ENTITY_ID=tw-entity-001,ERP_DEV_ENVIRONMENT=true,ERP_DEV_SNAPSHOT_DATE=2026-09-21,STAGED_OPERATIONS_ENABLED=false,WMS_PORTAL_URL=https://corely-wms-dev-sp5g377smq-de.a.run.app" \
  --port=8080 --memory=512Mi --cpu=1 --max-instances=2 --min-instances=0 \
  --allow-unauthenticated --labels=environment=dev,application=corely-erp --quiet
gcloud run services describe corely-erp-dev --project="$PROJECT" --region="$REGION" --format='value(status.url)'

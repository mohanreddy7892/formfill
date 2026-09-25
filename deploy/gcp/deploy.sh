#!/usr/bin/env bash
# Deploy FormFill + FormFill MCP to Google Cloud Run (Mumbai) with a Cloud Storage bucket for /data.
# Run from the repo root in Cloud Shell or any machine with gcloud:   bash deploy/gcp/deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:?export PROJECT_ID=<your-gcp-project-id>}"
REGION="${REGION:-asia-south1}"                 # Mumbai
BUCKET="${BUCKET:-${PROJECT_ID}-formfill-data}"
APP="formfill"; MCP="formfill-mcp"
PUBLIC_APP_URL="${PUBLIC_APP_URL:-}"            # e.g. https://forms.example.com (set after Cloudflare is ready)
PUBLIC_MCP_URL="${PUBLIC_MCP_URL:-}"            # e.g. https://mcp.example.com

gcloud config set project "$PROJECT_ID" >/dev/null
echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com

echo "==> Bucket gs://$BUCKET (blank forms + field layouts only)"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access \
    --public-access-prevention

echo "==> Secrets (generated once, reused on redeploy)"
make_secret() {
  gcloud secrets describe "$1" >/dev/null 2>&1 || \
    python3 -c "import secrets;print(secrets.token_urlsafe(32),end='')" | gcloud secrets create "$1" --data-file=- --replication-policy=automatic
}
make_secret formfill-token          # app token: distribute securely to authorized app users
make_secret formfill-mcp-token      # bearer token for MCP clients (Claude Desktop, Cursor...)

SA="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
for s in formfill-token formfill-mcp-token; do
  gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin >/dev/null

echo "==> Deploying $APP"
gcloud run deploy "$APP" --source . --region "$REGION" \
  --port 8000 --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3 --concurrency 20 --timeout 120 \
  --allow-unauthenticated \
  --set-env-vars FORMFILL_DATA=/data \
  --set-secrets FORMFILL_TOKEN=formfill-token:latest \
  --add-volume name=data,type=cloud-storage,bucket="$BUCKET" \
  --add-volume-mount volume=data,mount-path=/data
APP_URL="$(gcloud run services describe "$APP" --region "$REGION" --format='value(status.url)')"

echo "==> Deploying $MCP"
# max-instances=1 keeps short-lived download links on one instance (they live in memory only)
gcloud run deploy "$MCP" --source mcp_server --region "$REGION" \
  --memory 512Mi --cpu 1 --min-instances 0 --max-instances 1 --timeout 120 \
  --allow-unauthenticated \
  --set-env-vars "FORMFILL_URL=$APP_URL,FORMFILL_MCP_STATELESS=1,FORMFILL_MCP_PUBLIC_URL=${PUBLIC_MCP_URL}" \
  --set-secrets FORMFILL_TOKEN=formfill-token:latest,FORMFILL_MCP_TOKEN=formfill-mcp-token:latest
MCP_URL="$(gcloud run services describe "$MCP" --region "$REGION" --format='value(status.url)')"

cat <<DONE

Deployed.
  FormFill origin : $APP_URL
  MCP origin      : $MCP_URL/mcp
Next (see deploy/DEPLOY.md):
  1. Put these origins in deploy/cloudflare/wrangler.toml and deploy the Worker.
  2. Read the tokens:
       gcloud secrets versions access latest --secret=formfill-token      # -> authorized app users (token prompt)
       gcloud secrets versions access latest --secret=formfill-mcp-token  # -> give to MCP users
  3. Re-run this script with PUBLIC_MCP_URL=https://mcp.<your-domain> so download links use your domain.
DONE

#!/usr/bin/env bash
set -euo pipefail

WEBHOOK_URL="${PRODUCTION_DEPLOY_WEBHOOK_URL:-}"
WEBHOOK_SECRET="${PRODUCTION_DEPLOY_WEBHOOK_SECRET:-}"
PUBLISH_METADATA_PATH="${PUBLISH_METADATA_PATH:-publish-metadata.json}"

usage() {
  cat <<'EOF'
Usage: scripts/trigger-production-deploy.sh

Send signed immutable image metadata to the protected production deploy endpoint.

Required environment:
  PRODUCTION_DEPLOY_WEBHOOK_URL     HTTPS endpoint for the deploy agent
  PRODUCTION_DEPLOY_WEBHOOK_SECRET  Shared HMAC secret

Optional environment:
  PUBLISH_METADATA_PATH             Path to publish-metadata.json
  PRODUCTION_DEPLOY_ACCESS_CLIENT_ID
  PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET
                                    Optional Cloudflare Access service token
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$WEBHOOK_URL" || -z "$WEBHOOK_SECRET" ]]; then
  echo "Error: PRODUCTION_DEPLOY_WEBHOOK_URL and PRODUCTION_DEPLOY_WEBHOOK_SECRET are required" >&2
  exit 1
fi

if [[ ! "$WEBHOOK_URL" =~ ^https:// ]]; then
  echo "Error: PRODUCTION_DEPLOY_WEBHOOK_URL must be an HTTPS URL" >&2
  exit 1
fi

if [[ ! -f "$PUBLISH_METADATA_PATH" ]]; then
  echo "Error: publish metadata file not found: $PUBLISH_METADATA_PATH" >&2
  exit 1
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd openssl

image_ref="$(jq -r '.image_ref // ""' "$PUBLISH_METADATA_PATH")"
if [[ ! "$image_ref" =~ @sha256:[a-fA-F0-9]{64}$ ]]; then
  echo "Error: image_ref must be an immutable digest reference" >&2
  exit 1
fi

for field in git_commit build_date; do
  value="$(jq -r --arg field "$field" '.[$field] // ""' "$PUBLISH_METADATA_PATH")"
  if [[ -z "$value" ]]; then
    echo "Error: publish metadata field is required: $field" >&2
    exit 1
  fi
done

payload="$(jq -c '{
  image_ref,
  git_commit,
  git_tag,
  build_date,
  source_sha,
  source_ref,
  trigger_event
}' "$PUBLISH_METADATA_PATH")"
timestamp="$(date -u +%s)"
nonce="$(openssl rand -hex 16)"
signed_payload="${timestamp}.${nonce}.${payload}"
signature="$(printf '%s' "$signed_payload" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -r | awk '{print $1}')"

curl_args=(
  --fail \
  --silent \
  --show-error \
  --retry 2 \
  --request POST \
  --header "Content-Type: application/json" \
  --header "X-Oksskolten-Deploy-Timestamp: ${timestamp}" \
  --header "X-Oksskolten-Deploy-Nonce: ${nonce}" \
  --header "X-Oksskolten-Deploy-Signature: sha256=${signature}" \
  --data "$payload"
)

if [[ -n "${PRODUCTION_DEPLOY_ACCESS_CLIENT_ID:-}" || -n "${PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET:-}" ]]; then
  if [[ -z "${PRODUCTION_DEPLOY_ACCESS_CLIENT_ID:-}" || -z "${PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET:-}" ]]; then
    echo "Error: both Cloudflare Access service token values are required when either is set" >&2
    exit 1
  fi
  curl_args+=(
    --header "CF-Access-Client-Id: ${PRODUCTION_DEPLOY_ACCESS_CLIENT_ID}"
    --header "CF-Access-Client-Secret: ${PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET}"
  )
fi

curl "${curl_args[@]}" "$WEBHOOK_URL"

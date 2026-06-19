#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${OKSSKOLTEN_DEPLOY_CONFIG:-/etc/oksskolten/deploy.env}"
BODY_PATH="${OKSSKOLTEN_DEPLOY_BODY_PATH:-}"
MAX_SKEW_SECONDS="${OKSSKOLTEN_DEPLOY_MAX_SKEW_SECONDS:-600}"

usage() {
  cat <<'EOF'
Usage: scripts/production-deploy-agent.sh

Server-side restricted deploy entrypoint. Invoke it from a protected webhook
adapter after mapping request headers to environment variables.

Required local config file values:
  OKSSKOLTEN_DEPLOY_SECRET  Shared HMAC secret
  DEPLOY_DIR                Directory containing compose.yaml and compose.prod.yaml
  PROJECT_NAME              Docker Compose project name
  DATA_DIR                  Persistent data directory used in the app .env
  PUBLIC_URL                Public app URL used for final /api/health verification

Optional local config file values:
  ALLOWED_IMAGE_REPO        Required image_ref prefix, for example ghcr.io/org/app
  MEILI_MASTER_KEY          Persisted to app .env when set locally
  TUNNEL_TOKEN              Persisted to app .env when set locally
  GHCR_USERNAME             Optional registry login username
  GHCR_TOKEN                Optional registry login token
  NONCE_DIR                 Replay-protection nonce directory

Required request header environment variables:
  HTTP_X_OKSSKOLTEN_DEPLOY_TIMESTAMP
  HTTP_X_OKSSKOLTEN_DEPLOY_NONCE
  HTTP_X_OKSSKOLTEN_DEPLOY_SIGNATURE

The request body must be the publish metadata JSON from publish.yaml.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command not found: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd docker
require_cmd jq
require_cmd openssl

if [[ ! -f "$CONFIG_PATH" ]]; then
  echo "Error: deploy config not found: $CONFIG_PATH" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$CONFIG_PATH"

: "${OKSSKOLTEN_DEPLOY_SECRET:?OKSSKOLTEN_DEPLOY_SECRET is required}"
: "${DEPLOY_DIR:?DEPLOY_DIR is required}"
: "${PROJECT_NAME:?PROJECT_NAME is required}"
: "${DATA_DIR:?DATA_DIR is required}"
: "${PUBLIC_URL:?PUBLIC_URL is required}"

timestamp="${HTTP_X_OKSSKOLTEN_DEPLOY_TIMESTAMP:-${OKSSKOLTEN_DEPLOY_TIMESTAMP:-}}"
nonce="${HTTP_X_OKSSKOLTEN_DEPLOY_NONCE:-${OKSSKOLTEN_DEPLOY_NONCE:-}}"
provided_signature="${HTTP_X_OKSSKOLTEN_DEPLOY_SIGNATURE:-${OKSSKOLTEN_DEPLOY_SIGNATURE:-}}"

if [[ -n "$BODY_PATH" ]]; then
  body="$(cat "$BODY_PATH")"
else
  body="$(cat)"
fi

verify_signature() {
  if [[ -z "$timestamp" || -z "$nonce" || -z "$provided_signature" ]]; then
    echo "Error: deploy signature headers are required" >&2
    return 1
  fi
  if [[ ! "$timestamp" =~ ^[0-9]+$ || ! "$nonce" =~ ^[a-fA-F0-9]{32}$ ]]; then
    echo "Error: invalid timestamp or nonce" >&2
    return 1
  fi

  local now delta nonce_dir nonce_path expected_signature
  now="$(date -u +%s)"
  delta=$(( now > timestamp ? now - timestamp : timestamp - now ))
  if (( delta > MAX_SKEW_SECONDS )); then
    echo "Error: deploy request timestamp is outside allowed skew" >&2
    return 1
  fi

  nonce_dir="${NONCE_DIR:-/var/lib/oksskolten-deploy/nonces}"
  install -d -m 700 "$nonce_dir"
  find "$nonce_dir" -type f -mmin +60 -delete 2>/dev/null || true
  nonce_path="${nonce_dir}/${timestamp}.${nonce}"
  if ! (set -C; : > "$nonce_path") 2>/dev/null; then
    echo "Error: deploy nonce was already used" >&2
    return 1
  fi

  expected_signature="sha256=$(printf '%s.%s.%s' "$timestamp" "$nonce" "$body" | openssl dgst -sha256 -hmac "$OKSSKOLTEN_DEPLOY_SECRET" -r | awk '{print $1}')"
  if [[ "$provided_signature" != "$expected_signature" ]]; then
    echo "Error: invalid deploy signature" >&2
    return 1
  fi
}

verify_signature

image_ref="$(jq -r '.image_ref // ""' <<<"$body")"
expected_git_commit="$(jq -r '.git_commit // ""' <<<"$body")"
expected_git_tag="$(jq -r '.git_tag // ""' <<<"$body")"
expected_build_date="$(jq -r '.build_date // ""' <<<"$body")"

if [[ ! "$image_ref" =~ @sha256:[a-fA-F0-9]{64}$ ]]; then
  echo "Error: image_ref must be an immutable digest reference" >&2
  exit 1
fi

if [[ -n "${ALLOWED_IMAGE_REPO:-}" && "$image_ref" != "${ALLOWED_IMAGE_REPO}"@sha256:* ]]; then
  echo "Error: image_ref is outside the allowed repository" >&2
  exit 1
fi

if [[ -z "$expected_git_commit" || -z "$expected_build_date" ]]; then
  echo "Error: git_commit and build_date are required for deploy verification" >&2
  exit 1
fi

cd "$DEPLOY_DIR"

env_owner="$(stat -c '%u:%g' .)"

touch .env
chmod 600 .env
chown "$env_owner" .env 2>/dev/null || true

set_env() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  if [[ -f .env ]]; then
    grep -v "^${key}=" .env > "$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" .env
  chmod 600 .env
  chown "$env_owner" .env 2>/dev/null || true
}

get_env() {
  local key="$1"
  sed -n "s/^${key}=//p" .env | tail -n 1
}

compose() {
  docker compose -p "$PROJECT_NAME" -f compose.yaml -f compose.prod.yaml "$@"
}

wait_for_server_health() {
  local server_cid deadline status
  server_cid="$(compose ps -q server)"
  if [[ -z "$server_cid" ]]; then
    echo "Error: server container not found after deploy" >&2
    return 1
  fi

  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$server_cid")"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    if [[ "$status" == "unhealthy" || "$status" == "exited" ]]; then
      echo "Error: server container entered bad state: $status" >&2
      docker logs --tail 120 "$server_cid" >&2 || true
      return 1
    fi
    sleep 2
  done

  echo "Error: timed out waiting for healthy server container" >&2
  docker logs --tail 120 "$server_cid" >&2 || true
  return 1
}

validate_health_json() {
  local health_json="$1"

  if [[ -n "$expected_git_commit" && "$health_json" != *"\"gitCommit\":\"$expected_git_commit\""* ]]; then
    echo "Error: gitCommit mismatch in /api/health: $health_json" >&2
    return 1
  fi
  if [[ -n "$expected_git_tag" && "$health_json" != *"\"gitTag\":\"$expected_git_tag\""* ]]; then
    echo "Error: gitTag mismatch in /api/health: $health_json" >&2
    return 1
  fi
  if [[ -n "$expected_build_date" && "$health_json" != *"\"buildDate\":\"$expected_build_date\""* ]]; then
    echo "Error: buildDate mismatch in /api/health: $health_json" >&2
    return 1
  fi
}

wait_for_public_health() {
  local deadline public_health
  deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if public_health="$(curl --fail --silent --show-error "${PUBLIC_URL}/api/health" 2>/dev/null)"; then
      validate_health_json "$public_health"
      printf '%s\n' "$public_health"
      return 0
    fi
    sleep 3
  done
  return 1
}

ensure_cloudflared_running() {
  local cloudflared_cid status
  cloudflared_cid="$(compose ps -q cloudflared 2>/dev/null || true)"
  if [[ -n "$cloudflared_cid" ]]; then
    status="$(docker inspect -f '{{.State.Status}}' "$cloudflared_cid" 2>/dev/null || true)"
    if [[ "$status" == "running" ]]; then
      return 0
    fi
  fi

  compose up -d cloudflared
}

rollback_to_previous() {
  local previous_image="$1"
  if [[ -z "$previous_image" ]]; then
    echo "No previous SERVER_IMAGE found; skipping rollback" >&2
    return 0
  fi

  echo "Rolling back server image" >&2
  set_env SERVER_IMAGE "$previous_image"
  compose pull server || true
  compose up -d --no-deps server || true
  wait_for_server_health || true
  ensure_cloudflared_running || true
}

previous_server_image="$(get_env SERVER_IMAGE || true)"
if [[ -z "$previous_server_image" ]]; then
  server_cid="$(compose ps -q server 2>/dev/null || true)"
  if [[ -n "$server_cid" ]]; then
    previous_server_image="$(docker inspect -f '{{.Config.Image}}' "$server_cid" 2>/dev/null || true)"
  fi
fi

cleanup_on_error() {
  local exit_code="$1"
  if (( exit_code != 0 )); then
    rollback_to_previous "$previous_server_image"
  fi
  exit "$exit_code"
}
trap 'cleanup_on_error $?' EXIT

if [[ -n "${GHCR_USERNAME:-}" && -n "${GHCR_TOKEN:-}" ]]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin >/dev/null
fi

set_env SERVER_IMAGE "$image_ref"
set_env DATA_DIR "$DATA_DIR"

if [[ -n "${MEILI_MASTER_KEY:-}" ]]; then
  set_env MEILI_MASTER_KEY "$MEILI_MASTER_KEY"
fi
if [[ -n "${TUNNEL_TOKEN:-}" ]]; then
  set_env TUNNEL_TOKEN "$TUNNEL_TOKEN"
fi

compose pull server
compose up -d --no-deps server
wait_for_server_health

local_health="$(curl --fail --silent --show-error http://127.0.0.1:3000/api/health)"
validate_health_json "$local_health"

ensure_cloudflared_running
public_health="$(wait_for_public_health)"

trap - EXIT

jq -n \
  --arg previous_image "$previous_server_image" \
  --arg local_health "$local_health" \
  --arg public_health "$public_health" \
  '{ok: true, previousImage: $previous_image, localHealth: ($local_health | fromjson), publicHealth: ($public_health | fromjson)}'

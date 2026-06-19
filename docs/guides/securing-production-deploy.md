# Secure Production Deploy

This project uses a restricted deploy model for production:

1. GitHub Actions builds and publishes an immutable container image digest.
2. GitHub Actions sends signed image metadata to a protected deploy endpoint.
3. The production server verifies the signature and runs a local fixed deploy action.
4. The server pulls the digest, updates only the app server, checks health, and rolls back on failure.

The public repository must not contain the production server address, login user, deploy directory, or long-lived credentials.

## GitHub Configuration

Set these values in the protected `production` environment.

Variables:

- `PUBLIC_URL`: public application URL used by the workflow environment summary.

Secrets:

- `PRODUCTION_DEPLOY_WEBHOOK_URL`: HTTPS endpoint for the protected deploy webhook.
- `PRODUCTION_DEPLOY_WEBHOOK_SECRET`: shared HMAC secret used by the webhook trigger and server agent.
- `PRODUCTION_DEPLOY_ACCESS_CLIENT_ID`: optional Cloudflare Access service token ID.
- `PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET`: optional Cloudflare Access service token secret.

Do not store production SSH credentials in GitHub Actions for this deploy flow.

## Server Configuration

Install the production compose files on the server manually during bootstrap:

```bash
install -d -m 700 /etc/oksskolten
install -d "$DEPLOY_DIR"
cp compose.yaml compose.prod.yaml "$DEPLOY_DIR"/
```

Create a server-local deploy config. This file is not part of the repository:

```bash
cat >/etc/oksskolten/deploy.env <<'EOF'
OKSSKOLTEN_DEPLOY_SECRET=replace-with-shared-secret
DEPLOY_DIR=/path/to/deploy
PROJECT_NAME=oksskolten
DATA_DIR=./data
PUBLIC_URL=https://example.invalid
ALLOWED_IMAGE_REPO=ghcr.io/owner/repo
MEILI_MASTER_KEY=replace-with-local-secret
TUNNEL_TOKEN=replace-with-local-secret
# GHCR_USERNAME=
# GHCR_TOKEN=
# NONCE_DIR=/var/lib/oksskolten-deploy/nonces
EOF
chmod 600 /etc/oksskolten/deploy.env
```

Run the local webhook adapter on the server:

```bash
OKSSKOLTEN_DEPLOY_CONFIG=/etc/oksskolten/deploy.env \
OKSSKOLTEN_DEPLOY_WEBHOOK_HOST=127.0.0.1 \
OKSSKOLTEN_DEPLOY_WEBHOOK_PORT=8787 \
OKSSKOLTEN_DEPLOY_WEBHOOK_PATH=/deploy \
scripts/production-deploy-webhook.py
```

The adapter only accepts `POST` on the configured path and passes the request body plus deploy signature headers to `scripts/production-deploy-agent.sh`.

The production `cloudflared` sidecar runs with host networking so Cloudflare Tunnel routes can target host-local services without publishing them on public interfaces:

- Public application route: `http://127.0.0.1:3000`
- Protected deploy route: `http://127.0.0.1:8787/<configured-path>`

Example systemd unit:

```ini
[Unit]
Description=Oksskolten production deploy webhook
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/deploy
Environment=OKSSKOLTEN_DEPLOY_CONFIG=/etc/oksskolten/deploy.env
Environment=OKSSKOLTEN_DEPLOY_WEBHOOK_HOST=127.0.0.1
Environment=OKSSKOLTEN_DEPLOY_WEBHOOK_PORT=8787
Environment=OKSSKOLTEN_DEPLOY_WEBHOOK_PATH=/deploy
ExecStart=/path/to/deploy/scripts/production-deploy-webhook.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Recommended protections:

- Put the webhook behind Cloudflare Access, mTLS, or an equivalent access-control layer.
- When using Cloudflare Access, set `PRODUCTION_DEPLOY_ACCESS_CLIENT_ID` and `PRODUCTION_DEPLOY_ACCESS_CLIENT_SECRET` in the protected GitHub environment so the trigger can pass `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
- Allow only `POST`.
- Limit request body size.
- Keep the endpoint path unguessable.
- Send agent stdout/stderr to server-local logs.

## Deploy Guarantees

The server-side agent rejects mutable image tags. The `image_ref` must end with an immutable digest:

```text
ghcr.io/owner/repo@sha256:<64 hex chars>
```

The agent performs these actions only:

- Verify HMAC signature, timestamp skew, and one-time nonce.
- Optionally enforce `ALLOWED_IMAGE_REPO`.
- Write `SERVER_IMAGE` and local runtime values to `.env`.
- `docker compose pull server`.
- `docker compose up -d --no-deps server`.
- Wait for the `server` container to become healthy.
- Validate local `/api/health` metadata.
- Ensure `cloudflared` is running without restarting a healthy tunnel.
- Validate public `/api/health` metadata.
- Roll back to the previous image if any step fails.

## Manual Recovery

The previous image is retained in `.env` until a new deploy updates `SERVER_IMAGE`. To recover manually, set `SERVER_IMAGE` to a known-good digest and run:

```bash
cd "$DEPLOY_DIR"
docker compose -p "$PROJECT_NAME" -f compose.yaml -f compose.prod.yaml pull server
docker compose -p "$PROJECT_NAME" -f compose.yaml -f compose.prod.yaml up -d --no-deps server
docker compose -p "$PROJECT_NAME" -f compose.yaml -f compose.prod.yaml restart cloudflared
curl --fail "$PUBLIC_URL/api/health"
```

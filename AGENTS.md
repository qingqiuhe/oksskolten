# Oksskolten

See `README.md` for project overview and `docs/spec/` for detailed specs.

## Database

SQLite (libsql, WAL mode) at `./data/rss.db`.

- **Reads:** `sqlite3 ./data/rss.db` works fine while the server is running (WAL allows concurrent readers).
- **Writes:** Direct sqlite3 CLI writes do not work while the server is running. WAL mode causes the server process to hold the DB connection, so external writes are silently lost. Use API endpoints instead, or add a temporary admin endpoint in `server/routes/admin.ts` for one-off data injection.
- **API keys:** Create from Settings → Security → API Tokens. Use `read,write` scope for mutation endpoints. Example: `curl -H "Authorization: Bearer ok_..." http://localhost:3000/api/...`

## Language

- **Chat:** Respond in the same language the user speaks.
- **Issues, PRs, and commit messages:** Always use English.

## Deploy Notes

- For `mangu` production deploys, use [`scripts/deploy-mangu.sh`](/Users/te/workspace/codex/oksskolten/scripts/deploy-mangu.sh) instead of ad hoc compose commands.
- The live target on `mangu` is `/home/admin/oksskolten`, compose project `oksskolten`, and persistent data dir `./data`.
- The production CD path is now GitHub Actions `Test` -> `Publish Docker image` -> `Deploy mangu`. The first end-to-end green chain was on commit `c4f6985`, with publish run `23831547950` and deploy run `23831665270`.
- Production deploys are image-based, not source-build-based. `compose.prod.yaml` should resolve `server` from `SERVER_IMAGE=ghcr.io/qingqiuhe/oksskolten@sha256:...`, and remote `.env` should retain that digest for rollback/debugging.
- Required GitHub Actions repo variables for auto deploy: `REMOTE_HOST`, `REMOTE_PORT`, `REMOTE_DIR`, `PROJECT_NAME`, `DATA_DIR`, `PUBLIC_URL`, `GHCR_USERNAME`.
- Required GitHub Actions repo secrets for auto deploy: `MANGU_SSH_PRIVATE_KEY`, `MEILI_MASTER_KEY`, `TUNNEL_TOKEN`. `GHCR_TOKEN` is optional and only needed if the remote host cannot pull public GHCR images anonymously.
- Do not treat a successful sync or local container start as sufficient proof of success. Always verify external `/api/health` and compare `buildDate`.
- For successful CD verification, check both the Actions run results and live metadata: public `/api/health` must match the published `gitCommit` and `buildDate`, not just return `200`.
- If public `/api/health` works but `/` returns `404`, check `/app/dist/index.html` inside `oksskolten-server-1` before blaming Cloudflare Tunnel.
- On this host, Docker BuildKit may fail during image export with `error reading from server: EOF`. Fall back to classic builder with `DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0` and rebuild `server` with `--no-cache`.
- If `docker compose up -d` fails with `container name ... already in use`, remove the stale `oksskolten-server-1` container explicitly and retry.
- `cloudflared` can hold stale origin connections after a rebuild. If the app is healthy but the public domain still fails, restart `cloudflared`.
- `scripts/deploy-mangu.sh` intentionally updates only `server` plus a final `cloudflared` restart. Do not widen it back to `compose up` on `meilisearch` / `rss-bridge` / `flaresolverr` during normal app deploys; restarting dependencies caused avoidable production instability during CD validation.
- When modifying `scripts/deploy-mangu.sh`, preserve the rule that empty optional values must not overwrite remote `.env`. A local or CI run without `MEILI_MASTER_KEY` must not blank the existing remote key.
- If `Deploy mangu` appears stuck for a few minutes, check live `https://reader.qingqiuhe.cc.cd/api/health` before assuming failure. During the successful run, the public endpoint briefly returned `502` while `server` and `cloudflared` were rotating, then recovered to the new digest before the workflow finished.
- If `Publish Docker image` fails in multi-arch runtime install, avoid adding another networked `npm ci` in the runtime stage. The validated fix was to reuse pruned dependencies from an earlier stage (`npm prune --omit=dev`) instead of reinstalling during the final image build.
- `searchReady` in `/api/health` is separate from basic site reachability. A deploy can be externally reachable while search indexing is still recovering.

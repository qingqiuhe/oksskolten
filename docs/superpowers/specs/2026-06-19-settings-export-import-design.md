# Settings Export And Import Design

## Goal

Oksskolten should let an owner or admin export and import the platform settings that are needed to recreate configuration on another install. The feature is a settings transfer, not a full database backup.

## Confirmed Scope

The chosen mode is B:

- Export/import all recoverable settings.
- Do not include sensitive values by default.
- Allow owners/admins to explicitly include sensitive values.
- Exclude non-portable security artifacts and feed-bound rules.

In scope:

- Instance settings used by the Settings UI:
  - GitHub OAuth and password-auth settings under `auth.*`
  - feed fetch minimum interval under `system.feed_min_check_interval_minutes`
  - image storage settings under `images.*`
  - RSSHub social source setting under `social.rsshub_base_url`
- Current user's user settings:
  - profile settings: `profile.account_name`, `profile.avatar_seed`, `general.language`
  - preferences from Settings, including appearance, reading, task model choices, Ollama, custom themes, translation target, and retention
  - provider API keys under `api_key.*`
- Current user's custom LLM providers from `custom_llm_providers`
- Current user's notification channels from `notification_channels`

Out of scope:

- `system.jwt_secret`
- API tokens from `api_keys`
- passkeys / WebAuthn credentials from `credentials`
- users, members, invitations, password hashes, GitHub account links
- feeds, categories, articles, conversations, search indexes
- feed-bound notification tasks and rules from `feed_notification_rules` and `feed_notification_rule_channels`
- transient provider usage counters such as translation monthly usage

## Security Model

Export is owner/admin only. Import is owner/admin only. This keeps the feature aligned with platform-level configuration and avoids members importing instance-wide settings.

The default export must not contain secret values. The exported JSON should include metadata showing that secrets were excluded or redacted.

`includeSecrets=true` may include:

- `auth.github_client_secret`
- provider API keys under `api_key.*`
- custom LLM provider `api_key`
- `images.upload_headers`
- `ollama.custom_headers`
- notification channel `webhook_url`
- notification channel `secret`

The following values must never be exported or imported even when secrets are included:

- `system.jwt_secret`
- API token hashes or prefixes
- passkey credentials
- password hashes

Importing a default no-secret export should be safe: it may restore non-sensitive settings and skip records that cannot be recreated without required secrets. It must not erase existing local secrets merely because the import bundle omitted them.

## API Design

Add these authenticated owner/admin endpoints:

- `GET /api/settings/export?includeSecrets=0|1`
- `POST /api/settings/import/preview`
- `POST /api/settings/import`

`GET /api/settings/export` returns a JSON attachment named like `oksskolten-settings-YYYY-MM-DD.json`.

The export shape:

```json
{
  "app": "oksskolten",
  "version": 1,
  "exportedAt": "2026-06-19T00:00:00.000Z",
  "includeSecrets": false,
  "scope": {
    "instance": true,
    "user": "current"
  },
  "instanceSettings": [
    { "key": "social.rsshub_base_url", "value": "https://rsshub.example.com" }
  ],
  "userSettings": [
    { "key": "appearance.color_theme", "value": "nord" }
  ],
  "customLlmProviders": [
    {
      "id": 12,
      "name": "DeepSeek",
      "kind": "openai-compatible",
      "base_url": "https://api.deepseek.com",
      "api_key": null,
      "secretRedacted": true
    }
  ],
  "notificationChannels": [
    {
      "id": 5,
      "type": "feishu_webhook",
      "name": "Team Feed",
      "webhook_url": null,
      "secret": null,
      "timezone": "UTC+8",
      "enabled": 1,
      "secretRedacted": true
    }
  ],
  "excluded": [
    { "type": "setting", "key": "system.jwt_secret", "reason": "jwt_secret_never_exported" },
    { "type": "table", "key": "api_keys", "reason": "api_tokens_not_recoverable" },
    { "type": "table", "key": "credentials", "reason": "passkeys_not_portable" },
    { "type": "table", "key": "feed_notification_rules", "reason": "feed_bound_rules_out_of_scope" }
  ]
}
```

`POST /api/settings/import/preview` accepts the same JSON bundle and returns a summary without writing to the database.

`POST /api/settings/import` accepts the same JSON bundle, validates it, and writes the supported records inside a transaction.

Preview/import response shape:

```json
{
  "ok": true,
  "summary": {
    "instanceSettings": { "created": 0, "updated": 2, "skipped": 1 },
    "userSettings": { "created": 1, "updated": 8, "skipped": 0 },
    "customLlmProviders": { "created": 1, "updated": 0, "skipped": 1 },
    "notificationChannels": { "created": 1, "updated": 0, "skipped": 1 }
  },
  "warnings": [
    "Skipped custom LLM provider DeepSeek because api_key was redacted"
  ],
  "errors": []
}
```

If validation fails, the endpoint returns `400` and no writes occur.

## Import Semantics

Missing sections mean "leave existing state unchanged." Missing individual fields also mean "leave existing local value unchanged" when updating an existing record. The import feature is not a reset tool.

Flat settings:

- Supported keys are allowlisted.
- Unknown keys are skipped with a warning.
- `system.jwt_secret` is rejected or skipped even if present.
- Values are validated with the same rules used by existing settings endpoints.

Custom LLM providers:

- Match existing providers by `kind + normalized base_url + name`.
- If matched, update non-secret fields and update `api_key` only when the bundle contains a non-empty key.
- If not matched, create only when `api_key` is present.
- Keep an imported-id to local-id map.
- Rewrite imported `chat.provider_instance_id`, `summary.provider_instance_id`, and `translate.provider_instance_id` through that map before saving.
- If a provider reference cannot be mapped, skip that setting and return a warning.

Notification channels:

- Match by `type + name`.
- If matched, update non-secret fields and update `webhook_url` / `secret` only when present.
- If not matched, create only when `webhook_url` is present.
- Do not import or create feed notification rules.

Atomicity:

- Formal import validates the full supported payload before mutation.
- The mutation phase runs in a transaction.
- Invalid JSON, invalid values, invalid URLs, invalid provider references, or invalid notification channel records must not leave partial writes.

Cache invalidation:

- After formal import, invalidate settings-related runtime caches for feed schedule, social RSSHub, and article image storage path.

## Frontend Design

Add a new "Settings Transfer" section to Settings -> Data.

Controls:

- A checkbox or switch for "Include sensitive configuration".
- Export settings button.
- Import JSON file button.
- Import preview dialog showing summary, warnings, and a confirm button.

Behavior:

- Export downloads a JSON file from `GET /api/settings/export`.
- Import reads a local `.json` file, parses it in the browser, calls preview, and opens a confirmation dialog.
- Confirm calls `POST /api/settings/import`.
- After success, refresh settings-related SWR keys.

The UI must not describe the feature with long instructional text. It should use concise labels and status messages consistent with the existing Data tab.

## Acceptance Criteria

- Owner/admin can export settings JSON from Settings -> Data.
- Default export contains no secret values.
- Owner/admin can explicitly export with secrets included.
- Member users cannot use the settings transfer endpoints.
- `system.jwt_secret`, API tokens, passkeys, users, feeds, articles, conversations, and feed notification rules are excluded.
- Import preview reports creates, updates, skips, warnings, and errors without writing.
- Formal import writes supported settings atomically.
- Import does not delete existing local values because a field is missing from the bundle.
- Custom LLM provider ids are remapped before provider instance settings are saved.
- Notification channels import without importing feed-bound rules.
- The implementation has focused backend route tests and frontend component tests.

## Self Review

- No unresolved placeholders remain.
- Scope is intentionally narrower than full backup/restore.
- Sensitive defaults are explicit.
- Non-portable auth artifacts are excluded.
- The import strategy defines conflict behavior, provider id remapping, and transaction requirements.
- The frontend entry point matches the existing Settings -> Data information architecture.

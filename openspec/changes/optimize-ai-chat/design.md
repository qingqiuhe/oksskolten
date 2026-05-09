## Context

The current chat stack already supports scoped conversations, SSE streaming, tool execution, usage reporting, and optional debug traces. However, the frontend chat state in `src/hooks/use-chat.ts` is optimized for a single live turn rather than resilient conversation continuity. It appends text optimistically, shows transient thinking/tool indicators, and only attaches usage/debug metadata to the newest assistant bubble during the current session.

When a conversation is reloaded through `GET /api/chat/:id/messages`, the client rebuilds bubbles from plain text blocks only. Provider/model usage, elapsed time, tool activity, and turn outcome are not restored. Error handling is also split across transport failures, SSE `error` events, and server-side request validation, which leaves users with limited recovery paths after an interrupted or rejected turn.

This change spans frontend chat state, chat API response shape, and persisted turn metadata, so a design document is warranted before implementation.

## Goals / Non-Goals

**Goals:**
- Make each assistant turn understandable after the fact by preserving display-safe turn metadata.
- Add clear recovery flows for interrupted and failed turns without forcing the user to retype prompts.
- Keep the existing SSE transport and conversation model intact while making chat state more resilient.
- Surface common chat failures with actionable guidance instead of raw backend error text.

**Non-Goals:**
- Rebuild the chat UI visual style or message layout from scratch.
- Persist full raw provider request/response payloads for historical replay.
- Introduce a new job queue, websocket transport, or background conversation runner.
- Change how article scope, list scope, or prompt construction fundamentally work.

## Decisions

### 1. Persist lightweight assistant-turn metadata alongside chat messages

We will add a nullable metadata field for stored chat messages so the system can restore assistant-turn status without reparsing ephemeral SSE state. The stored payload will remain display-oriented: provider, model, elapsed time, token usage, final status (`complete`, `error`, `interrupted`), and a compact tool summary when available.

Rationale:
- The current database stores only content blocks, which is insufficient for reconstructing usage and outcome details.
- Storing a lightweight summary preserves continuity without bloating the database with full debug payloads.

Alternatives considered:
- Recompute metadata from existing chat message content on load. Rejected because usage, elapsed time, and failure status do not exist in stored content.
- Persist full `debug_trace` JSON for every turn. Rejected because it is much larger than the UI needs for normal conversation restoration.

### 2. Keep cancellation user-driven and cooperative

We will add a real stop action in the client using `AbortController`, propagate abort handling through the streaming request path, and treat a stopped turn as an explicit interrupted outcome in the UI. Backend transports should stop when the request closes where possible, but the primary contract is that the user sees the turn stop immediately and can retry from the latest user message.

Rationale:
- This preserves the existing request/response architecture.
- It gives users a reliable recovery action without introducing server-managed cancellation sessions.

Alternatives considered:
- Add a separate cancel endpoint keyed by conversation and turn id. Rejected because it introduces more state management than this optimization needs.
- Do nothing on stop beyond hiding the spinner. Rejected because it leaves the conversation in an ambiguous state.

### 3. Normalize chat errors into stable UI categories

The chat API and client state will map common failures into a small set of stable categories, such as `scope_mismatch`, `provider_setup_required`, `provider_failure`, and `network_interrupted`. The UI will render targeted copy and, when applicable, a direct recovery action such as retrying the last turn, opening settings, or starting a fresh conversation in the same scope.

Rationale:
- The current UI often surfaces raw error strings, which are inconsistent and hard to act on.
- Stable categories give us durable tests and localized UX copy.

Alternatives considered:
- Keep passing raw backend messages through `tError()`. Rejected because different failure sources do not align into consistent user actions.

### 4. Preserve drafts locally, not in the database

Unsent or interrupted input drafts will be stored in local browser state keyed by conversation context, not written to server-side tables.

Rationale:
- Draft preservation is a client continuity problem, not shared domain data.
- Local persistence avoids schema churn for text the user may never send.

Alternatives considered:
- Persist drafts in the conversation table. Rejected because drafts are device-local editing state and would complicate sync semantics.

## Risks / Trade-offs

- [Metadata schema drift] -> Keep the persisted turn metadata intentionally small and version-tolerant, with graceful fallback when fields are absent.
- [Abort behavior differs by provider transport] -> Treat interruption as a UI contract first; add server-side request-close handling where the adapter allows it.
- [Legacy conversations lack metadata] -> Render old conversations normally and omit the richer footer/status elements when metadata is unavailable.
- [Error normalization can hide useful detail] -> Preserve raw debug detail in debug mode while showing categorized user-facing copy in the standard UI.

## Migration Plan

1. Add a backward-compatible database migration for nullable chat-message metadata.
2. Update chat write paths to store metadata for new assistant turns only.
3. Update read APIs so restored conversations can return message metadata when present.
4. Roll out frontend support with graceful fallback for old messages that have no metadata.
5. If rollback is needed, older code can ignore the new nullable column and still render existing message content.

## Open Questions

- Should debug mode eventually fetch full persisted trace data for old conversations, or is live-session-only debug detail sufficient for the first iteration?

## Why

The current AI chat flow is usable, but it becomes fragile once a turn streams for a while, calls tools, or fails midway. Users can start a conversation, but they have limited visibility into what the assistant is doing, weak recovery options when a turn breaks, and incomplete continuity when they reopen an existing conversation.

## What Changes

- Add a conversation experience layer for AI chat that makes turn status, scope, and model usage visible during and after each response.
- Add recovery actions for interrupted or failed turns, including stopping generation, retrying the last turn, and preserving unsent draft input.
- Improve conversation hydration so reopening a chat restores the metadata needed to understand what happened in earlier turns, not just plain text bubbles.
- Standardize chat error states so scope mismatch, missing provider configuration, and provider-side failures are surfaced with actionable next steps instead of generic transient errors.

## Capabilities

### New Capabilities
- `ai-chat-experience`: Improves AI chat transparency, recovery, and conversation continuity across inline chat, full-page chat, and restored conversations.

### Modified Capabilities
- None.

## Impact

- Frontend chat state and UI under `src/hooks/use-chat.ts`, `src/components/chat/*`, and `src/pages/chat-page.tsx`
- Chat APIs and conversation payload shaping in `server/chatRoutes.ts` and related `server/chat/*` helpers
- Shared chat types and any persisted conversation metadata needed to restore richer turn state
- Tests covering chat streaming, error handling, and conversation reload behavior

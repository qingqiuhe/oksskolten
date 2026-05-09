## 1. Data and API shape

- [ ] 1.1 Add a backward-compatible chat message metadata field and document the persisted assistant-turn shape used for chat continuity.
- [ ] 1.2 Update chat read APIs to return assistant-turn metadata alongside stored message content, with graceful fallback for legacy conversations.

## 2. Server chat turn lifecycle

- [ ] 2.1 Update chat turn execution and persistence so completed, failed, and interrupted assistant turns store display-safe metadata including provider/model, elapsed time, usage, and compact tool summary.
- [ ] 2.2 Normalize chat failures into stable error categories for scope mismatch, provider setup issues, transient provider failures, and interrupted streams.
- [ ] 2.3 Propagate request abort handling through the streaming chat path so a user stop action can mark the current turn as interrupted.

## 3. Frontend chat recovery experience

- [ ] 3.1 Refactor `useChat` state to support turn status, retry metadata, and abortable streaming without losing existing scope behavior.
- [ ] 3.2 Update chat message rendering to show live turn state, persisted assistant-turn summaries, and actionable recovery controls for failed or interrupted turns.
- [ ] 3.3 Preserve chat drafts by conversation context and restore them when the user returns to the same chat flow.
- [ ] 3.4 Surface categorized error states with the correct recovery path, including retry, start-new-conversation, and settings navigation.

## 4. Verification

- [ ] 4.1 Add or update backend tests covering metadata persistence, error categorization, and interrupted-stream behavior.
- [ ] 4.2 Add or update frontend tests covering retry flow, draft restoration, and restored conversation summaries.
- [ ] 4.3 Run targeted lint, typecheck, and test commands for the affected chat modules.

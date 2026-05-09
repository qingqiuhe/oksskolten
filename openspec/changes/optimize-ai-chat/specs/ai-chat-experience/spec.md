## ADDED Requirements

### Requirement: Chat SHALL expose active turn context
The system SHALL make the active conversation context understandable during and after each assistant turn. During streaming, the chat UI MUST show whether the assistant is thinking or running a tool. After a turn completes, fails, or is interrupted, the UI MUST show the provider/model used for that turn and any available usage summary.

#### Scenario: Live turn status is visible while streaming
- **WHEN** a user sends a chat message and the server emits thinking or tool events
- **THEN** the chat UI shows the current turn status without hiding previously rendered messages

#### Scenario: Completed turn shows execution summary
- **WHEN** an assistant turn finishes with usage metadata
- **THEN** the corresponding assistant message shows the model and execution summary for that turn

### Requirement: Users SHALL be able to recover from interrupted or failed turns
The system SHALL let the user stop an in-flight assistant turn, retry the latest failed or interrupted user turn, and continue from the preserved draft text without retyping it manually.

#### Scenario: User stops an in-flight response
- **WHEN** a user stops a streaming assistant turn
- **THEN** the stream ends immediately in the UI and the unfinished assistant turn is marked as interrupted

#### Scenario: User retries the last unsuccessful turn
- **WHEN** the latest assistant turn is marked failed or interrupted and the user chooses retry
- **THEN** the system resubmits the latest user prompt in the same conversation scope and starts a new assistant turn

#### Scenario: Draft text survives an interrupted flow
- **WHEN** chat input contains unsent or recoverable text and the user navigates away or a turn fails
- **THEN** the chat input restores that draft when the user returns to the same chat context

### Requirement: Conversation reload SHALL restore turn metadata
The system SHALL persist display-safe metadata for assistant turns so that reopening an existing conversation restores the turn outcome and summary information needed for continuity. At minimum, persisted metadata MUST support final status, provider/model, elapsed time, usage, and compact tool activity summary when available.

#### Scenario: Reopened conversation keeps assistant turn summaries
- **WHEN** a user opens an existing conversation that contains assistant turns with persisted metadata
- **THEN** the chat history view shows the same turn summaries and outcomes that were available when the conversation was first created

#### Scenario: Legacy conversation degrades gracefully
- **WHEN** a user opens an older conversation that does not have persisted turn metadata
- **THEN** the system still renders the conversation text and omits only the unavailable summary fields

### Requirement: Chat errors SHALL be actionable
The system SHALL classify known chat failures into stable user-facing error states and MUST provide the user with the next available recovery action.

#### Scenario: Scope mismatch suggests a fresh conversation
- **WHEN** a user sends a message to an existing conversation with a mismatched scope
- **THEN** the chat UI explains that the conversation scope changed and offers a way to start a new conversation in the current scope

#### Scenario: Missing provider setup points to settings
- **WHEN** chat fails because the selected provider or credentials are not configured
- **THEN** the UI explains that provider setup is required and links the user to the relevant settings surface

#### Scenario: Provider or network failure allows retry
- **WHEN** a chat turn fails because of a transient provider or network problem
- **THEN** the UI preserves the latest recoverable prompt and offers a retry action

# Complete Event Inventory

## Currently Persisted Events (ThreadEvent)
From `src/threads/types.ts`:
- USER_MESSAGE
- AGENT_MESSAGE  
- TOOL_CALL
- TOOL_APPROVAL_REQUEST
- TOOL_APPROVAL_RESPONSE
- TOOL_RESULT
- LOCAL_SYSTEM_MESSAGE
- SYSTEM_PROMPT
- USER_SYSTEM_PROMPT
- COMPACTION

## UI-Only Events (Not Persisted)
From `packages/web/types/web-sse.ts`:
- TOOL_APPROVAL_REQUEST (duplicate - exists in both?)
- TOOL_APPROVAL_RESPONSE (duplicate - exists in both?)
- AGENT_TOKEN (streaming chunks)
- AGENT_STREAMING (aggregated streaming)
- AGENT_STATE_CHANGE
- COMPACTION_START
- COMPACTION_COMPLETE

## Additional Event Types Found
From validation schemas and session-service:
- TOOL_AGGREGATED (timeline converter creates this)

## Agent EventEmitter Events (Not ThreadEvents)
From `src/agents/agent.ts` emits:
- message_queued
- turn_aborted
- token_budget_warning
- agent_thinking_start
- agent_thinking_complete
- agent_response_complete
- conversation_complete
- error
- agent_token
- token_usage_update
- retry_attempt
- retry_exhausted
- tool_call_start
- tool_call_complete
- state_change
- turn_start
- turn_progress
- turn_complete
- compaction_start
- compaction_complete
- thread_event_added
- queue_processing_start
- queue_processing_complete

## Stream Event Types (Being Deleted)
From `src/stream-events/types.ts`:
- Session events (wraps ThreadEvents)
- Task events: task:created, task:updated, task:deleted, task:note_added
- Agent events: agent:spawned, agent:started, agent:stopped
- Project events: project:created, project:updated, project:deleted
- Global events: system:maintenance, system:update, system:notification

## Events That Need to be in Unified System

### Must Persist (go in database):
- USER_MESSAGE
- AGENT_MESSAGE
- TOOL_CALL
- TOOL_RESULT
- TOOL_APPROVAL_REQUEST
- TOOL_APPROVAL_RESPONSE
- LOCAL_SYSTEM_MESSAGE
- SYSTEM_PROMPT
- USER_SYSTEM_PROMPT
- COMPACTION

### Transient (not persisted):
- AGENT_TOKEN
- AGENT_STREAMING
- AGENT_STATE_CHANGE
- COMPACTION_START
- COMPACTION_COMPLETE
- TOOL_AGGREGATED (created by timeline converter - can be deleted)

### Questionable/To Investigate:
- Why are TOOL_APPROVAL_REQUEST/RESPONSE in both persisted and UI events?
- Task events - do these need to be ThreadEvents or separate?
- Agent lifecycle events (spawned/started/stopped)
- Connection/error events

## Summary
We have:
- 10 persisted event types
- 7 UI-only event types (with 2 duplicates)
- ~25 Agent emitter events (internal, not ThreadEvents)
- Task/Project/Global events in StreamEvent wrapper

Total unique event types that need handling: ~17 (10 persisted + 5 truly transient + 2 duplicates to resolve)
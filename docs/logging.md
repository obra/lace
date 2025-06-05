# Lace Dual Logging System Implementation Spec

## Overview
Implement two separate logging systems for Lace:
1. **Activity Logging**: Always-on SQLite forensic audit trail
2. **Debug Logging**: Configurable traditional logging for development

## Task 1: CLI Arguments for Debug Logging ✅ COMPLETED

**Prompt:** Add CLI argument parsing for debug logging configuration to `src/cli.js`. Add these new arguments:
- `--log-level=<level>` - stderr debug output level (debug/info/warn/error/off)
- `--log-file=<path>` - file path for debug log output  
- `--log-file-level=<level>` - file debug output level (debug/info/warn/error/off)

Update the argument parsing and pass these options to the agent initialization.

**Implementation:** Added CLI arguments to `src/cli.js` and updated `src/lace.js` to pass debug logging options to Agent constructor as `debugLogging` object.

## Task 2: Debug Logging Framework ✅ COMPLETED

**Prompt:** Create `src/logging/debug-logger.js` that exports a configurable logger class with:
- Log levels: debug, info, warn, error
- Dual output: stderr and optional file
- Methods: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`
- Initialization from CLI args (levels and file path)
- Thread-safe file writing with timestamps

**Implementation:** Created `DebugLogger` class with configurable dual output, proper level filtering, timestamp formatting, async file writing with directory creation, and comprehensive unit tests in `test/unit/debug-logger.test.js`.

## Task 3: Activity Logging Database Schema ✅ COMPLETED

**Prompt:** Create `src/logging/activity-logger.js` with SQLite database setup. Schema:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  local_session_id TEXT NOT NULL,
  model_session_id TEXT,
  data TEXT NOT NULL
);
CREATE INDEX idx_session ON events(local_session_id);
CREATE INDEX idx_timestamp ON events(timestamp);
CREATE INDEX idx_event_type ON events(event_type);
```

Database location: `.lace/activity.db`. Export methods: `logEvent(type, localSessionId, modelSessionId, data)`.

**Implementation:** Created `ActivityLogger` class with SQLite database, events table with indexes, error-safe logging, query capabilities, and comprehensive unit tests in `test/unit/activity-logger.test.js`.

## Task 4: Console Message Activity Logging ✅ COMPLETED

**Prompt:** Integrate activity logging into `src/interface/console.js`:
- Log `user_input` events when user submits input
- Log `agent_response` events when agent completes responses
- Include full message content and timing
- Use existing session ID

Event data structure:
```json
{
  "user_input": {"content": "user message", "timestamp": "2025-01-01T12:00:00Z"},
  "agent_response": {"content": "agent response", "tokens": 150, "duration_ms": 1200}
}
```

**Implementation:** Integrated ActivityLogger into Console class with initialization, user input logging on message submission, agent response logging with timing and token data, and comprehensive tests in `test/unit/console-activity-logging.test.js`.

## Task 5: Model Call Activity Logging ✅ COMPLETED

**Prompt:** Integrate activity logging into `src/agents/agent.js` in the `processInput` method:
- Log `model_request` events before sending to provider
- Log `model_response` events after receiving response
- Include full prompt, response, tokens, costs, provider info
- Track conversation/session IDs from providers

Event data structure:
```json
{
  "model_request": {"provider": "anthropic", "model": "claude-3", "prompt": "...", "timestamp": "..."},
  "model_response": {"content": "...", "tokens_in": 100, "tokens_out": 50, "cost": 0.002, "duration_ms": 800}
}
```

**Implementation:** Integrated ActivityLogger into Agent class with model request/response logging around provider calls, cost calculation, timing data, error-safe logging, and comprehensive tests in `test/unit/agent-activity-logging.test.js`. Updated Lace class to pass ActivityLogger from Console to Agent.

## Task 6: Tool Call Activity Logging

**Prompt:** Integrate activity logging into `src/safety/tool-approval.js` and `src/tools/tool-registry.js`:

**In tool-approval.js:**
- Log `tool_approval_request` when tool needs approval
- Log `tool_approval_decision` with user's choice and any parameter modifications

**In tool-registry.js:**
- Log `tool_execution_start` before executing tool
- Log `tool_execution_complete` with results and timing

Event data structure:
```json
{
  "tool_approval_request": {"tool": "file-tool", "method": "read", "params": {...}, "risk_level": "medium"},
  "tool_approval_decision": {"approved": true, "modified_params": {...}, "user_decision": "approved"},
  "tool_execution_start": {"tool": "file-tool", "method": "read", "params": {...}},
  "tool_execution_complete": {"success": true, "result": {...}, "duration_ms": 50}
}
```

## Task 7: Model Provider Session ID Tracking

**Prompt:** Update model providers in `src/models/providers/` to track conversation IDs:
- `anthropic-provider.js`: Use conversation_id if available, generate UUID if not
- `openai-provider.js`: Use conversation_id if available, generate UUID if not  
- `local-provider.js`: Generate UUID per conversation
- Pass session IDs to activity logger

## Task 8: Integration and Testing

**Prompt:** Update `src/agents/agent.js` constructor to:
1. Initialize debug logger from CLI args
2. Initialize activity logger
3. Pass both loggers to relevant components
4. Replace existing console.log calls in agent.js with debug logger calls

Test both logging systems work independently and don't interfere with each other.

## Implementation Notes

- **API Key Redaction**: Defer for now since keys only appear in low-level HTTP headers
- **Database Location**: Default `.lace/activity.db`, create directory if needed
- **Error Handling**: Activity logging failures should not break normal operation
- **Performance**: Use async writes for activity logging, synchronous for debug logging
- **Backwards Compatibility**: Existing console.log calls should remain until systematically replaced

Each task can be implemented independently, with integration happening in Task 8.
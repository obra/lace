# Lace Dual Logging System

Lace implements a comprehensive dual logging system designed for both operational forensics and development debugging. The system consists of two independent but complementary logging mechanisms that work together without interference.

## Overview

### Two Independent Logging Systems

1. **Activity Logging**: Always-on SQLite-based forensic audit trail
   - Captures all user interactions, model calls, and tool executions
   - Stored in `.lace/activity.db` 
   - Never fails silently - designed for reliability
   - Used for debugging, auditing, and understanding system behavior

2. **Debug Logging**: Configurable development logging  
   - Traditional leveled logging (debug/info/warn/error)
   - Dual output: stderr and optional file
   - Controlled via CLI arguments
   - Used for development, troubleshooting, and verbose output

## Activity Logging System

### Database Schema

The activity logging system uses SQLite with the following schema:

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,           -- ISO 8601 timestamp
  event_type TEXT NOT NULL,          -- Type of event (see Event Types below)
  local_session_id TEXT NOT NULL,    -- Lace session identifier
  model_session_id TEXT,             -- Provider conversation ID (if available)
  data TEXT NOT NULL                 -- JSON event data
);

-- Performance indexes
CREATE INDEX idx_session ON events(local_session_id);
CREATE INDEX idx_timestamp ON events(timestamp);
CREATE INDEX idx_event_type ON events(event_type);
```

### Event Types

The system logs the following event types:

#### User Interaction Events
- **`user_input`**: User submits input to the system
- **`agent_response`**: Agent completes a response to user

#### Model Provider Events  
- **`model_request`**: Request sent to model provider (Anthropic, OpenAI, etc.)
- **`model_response`**: Response received from model provider

#### Tool Execution Events
- **`tool_approval_request`**: Tool requires user approval
- **`tool_approval_decision`**: User approves/denies tool execution
- **`tool_execution_start`**: Tool execution begins
- **`tool_execution_complete`**: Tool execution finishes

### Event Data Structures

Each event type has a specific JSON data structure:

```json
{
  "user_input": {
    "content": "user message", 
    "timestamp": "2025-01-01T12:00:00Z"
  },
  
  "agent_response": {
    "content": "agent response", 
    "tokens": 150, 
    "duration_ms": 1200
  },
  
  "model_request": {
    "provider": "anthropic", 
    "model": "claude-3-5-sonnet", 
    "prompt": "...", 
    "timestamp": "2025-01-01T12:00:00Z"
  },
  
  "model_response": {
    "content": "...", 
    "tokens_in": 100, 
    "tokens_out": 50, 
    "cost": 0.002, 
    "duration_ms": 800
  },
  
  "tool_approval_request": {
    "tool": "file-tool", 
    "method": "read", 
    "params": {...}, 
    "risk_level": "medium"
  },
  
  "tool_approval_decision": {
    "approved": true, 
    "modified_params": {...}, 
    "user_decision": "approved"
  },
  
  "tool_execution_start": {
    "tool": "file-tool", 
    "method": "read", 
    "params": {...}
  },
  
  "tool_execution_complete": {
    "success": true, 
    "result": {...}, 
    "duration_ms": 50
  }
}
```

### Usage

```javascript
import { ActivityLogger } from './src/logging/activity-logger.js';

const logger = new ActivityLogger(); // Uses default .lace/activity.db
await logger.initialize();

// Log an event
await logger.logEvent('user_input', sessionId, null, {
  content: 'Hello, world!',
  timestamp: new Date().toISOString()
});

// Query events
const events = await logger.getEvents({
  sessionId: 'session-123',
  eventType: 'model_request',
  limit: 50
});

await logger.close();
```

## Debug Logging System

### Configuration

Debug logging is configured via CLI arguments:

```bash
# Enable debug output to stderr
lace --log-level=debug

# Log to file with different levels
lace --log-level=info --log-file=./debug.log --log-file-level=debug

# Common configurations
lace --log-level=off                    # No debug output
lace --log-level=info                   # Important messages only  
lace --log-level=debug                  # Verbose development output
lace --log-file=./lace-debug.log        # File logging
```

### Log Levels

- **`debug`**: Verbose development information (iteration counts, tool spawning)
- **`info`**: Important status information (session totals, costs, task completion)
- **`warn`**: Warning conditions (tool synthesis failures)
- **`error`**: Error conditions (failures that don't stop execution)
- **`off`**: No logging

### Usage

```javascript
import { DebugLogger } from './src/logging/debug-logger.js';

const logger = new DebugLogger({
  logLevel: 'info',              // stderr level
  logFile: './debug.log',        // optional file path
  logFileLevel: 'debug'          // optional file level
});

// Log at different levels
logger.debug('Verbose development info');
logger.info('Important status update');
logger.warn('Warning condition occurred');
logger.error('Error that doesn\'t stop execution');
```

## Session ID Correlation

The dual logging system uses two types of session identifiers for correlation:

### Local Session ID
- Generated by Lace Console: `session-${Date.now()}`
- Used to correlate all events within a single Lace session
- Consistent across all activity events

### Model Session ID  
- Generated by model providers for conversation tracking
- UUIDs created per conversation context
- Used to correlate related model calls across sessions
- Stored in `model_session_id` field of activity events

## Architecture Integration

### Component Integration

The logging system is integrated throughout the Lace architecture:

```
Lace (main) 
├── ActivityLogger (shared instance)
├── Console (logs user_input/agent_response)
├── Agent (logs model_request/model_response, has DebugLogger)
│   ├── ApprovalEngine (logs approval events)
│   ├── ToolRegistry (logs execution events)
│   └── ModelProvider (generates session IDs)
└── Subagents (inherit both loggers)
```

### Error Isolation

Both logging systems are designed to fail gracefully:

- **Activity logging failures** don't affect debug logging or core functionality
- **Debug logging failures** don't affect activity logging or core functionality  
- **Both systems failing** doesn't break Lace operation

### Performance

- **Activity logging**: Async writes, minimal performance impact
- **Debug logging**: Immediate stderr, async file writes
- **Combined overhead**: < 200ms measured in tests

## How to Implement Logging in New Codebase Features

When implementing new features in Lace, follow these patterns for consistent logging:

### 1. Add Activity Logging Events

For any new user-facing feature or significant system operation:

#### Step 1: Define Event Types
```javascript
// Add new event types to your feature
const EVENT_TYPES = {
  FEATURE_START: 'feature_start',
  FEATURE_COMPLETE: 'feature_complete',
  FEATURE_ERROR: 'feature_error'
};
```

#### Step 2: Design Event Data Structure
```javascript
// Define consistent data structures
const eventData = {
  feature_start: {
    feature_name: 'my-feature',
    parameters: {...},
    timestamp: new Date().toISOString()
  },
  feature_complete: {
    success: true,
    result: {...},
    duration_ms: 1500
  }
};
```

#### Step 3: Add Logging Calls
```javascript
export class MyFeature {
  constructor(options = {}) {
    this.activityLogger = options.activityLogger || null;
  }

  async executeFeature(sessionId, params) {
    // Log feature start
    if (this.activityLogger) {
      await this.activityLogger.logEvent('feature_start', sessionId, null, {
        feature_name: 'my-feature',
        parameters: params,
        timestamp: new Date().toISOString()
      });
    }

    const startTime = Date.now();
    let success = true;
    let result = null;

    try {
      result = await this.doWork(params);
    } catch (error) {
      success = false;
      
      // Log feature error
      if (this.activityLogger) {
        await this.activityLogger.logEvent('feature_error', sessionId, null, {
          error: error.message,
          duration_ms: Date.now() - startTime
        });
      }
      throw error;
    }

    // Log feature completion
    if (this.activityLogger) {
      await this.activityLogger.logEvent('feature_complete', sessionId, null, {
        success: success,
        result: result,
        duration_ms: Date.now() - startTime
      });
    }

    return result;
  }
}
```

### 2. Add Debug Logging

For development and troubleshooting information:

#### Step 1: Accept Debug Logger in Constructor
```javascript
export class MyFeature {
  constructor(options = {}) {
    this.activityLogger = options.activityLogger || null;
    this.debugLogger = options.debugLogger || null; // Always pass instance, not config
  }
}
```

#### Step 2: Add Debug Logging Calls
```javascript
async executeFeature(sessionId, params) {
  if (this.debugLogger) {
    this.debugLogger.debug(`Starting feature execution with params: ${JSON.stringify(params)}`);
  }

  // ... implementation ...

  if (this.debugLogger) {
    this.debugLogger.info(`Feature completed successfully in ${duration}ms`);
  }
}
```

#### Step 3: Use Appropriate Log Levels
- **`debug`**: Detailed flow, parameters, internal state
- **`info`**: Important milestones, completion status
- **`warn`**: Recoverable errors, fallback behavior
- **`error`**: Serious errors that don't stop execution

### 3. Integration Patterns

#### Pass Loggers Through Constructor Options
```javascript
// In parent component - ALWAYS pass logger instances, never config
const myFeature = new MyFeature({
  activityLogger: this.activityLogger,  // ✅ Pass instance
  debugLogger: this.debugLogger,       // ✅ Pass instance
  // ... other options
});
```

#### Pass Loggers to Subcomponents
```javascript
// When spawning subcomponents
const subcomponent = new SubComponent({
  activityLogger: this.activityLogger,
  debugLogger: this.debugLogger
});
```

#### Handle Missing Loggers Gracefully
```javascript
// Always check for logger existence
if (this.activityLogger) {
  await this.activityLogger.logEvent(...);
}

if (this.debugLogger) {
  this.debugLogger.info(...);
}
```

### 4. Testing Your Logging

#### Write Unit Tests
```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ActivityLogger } from '../src/logging/activity-logger.js';
import { MyFeature } from '../src/my-feature.js';

describe('MyFeature Logging', () => {
  test('should log feature execution events', async () => {
    const activityLogger = new ActivityLogger(':memory:');
    await activityLogger.initialize();
    
    const feature = new MyFeature({ activityLogger });
    const sessionId = 'test-session';
    
    await feature.executeFeature(sessionId, { test: true });
    
    const events = await activityLogger.getEvents({ sessionId });
    
    const startEvent = events.find(e => e.event_type === 'feature_start');
    const completeEvent = events.find(e => e.event_type === 'feature_complete');
    
    assert.ok(startEvent, 'Should log feature start event');
    assert.ok(completeEvent, 'Should log feature complete event');
    
    await activityLogger.close();
  });
});
```

#### Integration Tests
```javascript
test('should work with both logging systems', async () => {
  const debugLogger = new DebugLogger({ logLevel: 'debug' });
  const activityLogger = new ActivityLogger(':memory:');
  await activityLogger.initialize();
  
  const feature = new MyFeature({ 
    activityLogger, 
    debugLogger 
  });
  
  // Test that both systems log independently
  const result = await feature.executeFeature('test-session', {});
  
  // Verify activity logging
  const events = await activityLogger.getEvents({});
  assert.ok(events.length > 0);
  
  // Verify debug logging doesn't interfere
  assert.ok(result);
  
  await activityLogger.close();
});
```

### 5. Documentation

Always document your logging:

```javascript
/**
 * MyFeature performs X operation with comprehensive logging
 * 
 * Activity Events Logged:
 * - feature_start: When feature execution begins
 * - feature_complete: When feature execution completes successfully  
 * - feature_error: When feature execution fails
 * 
 * Debug Logging:
 * - debug: Parameter details, internal flow
 * - info: Completion status, important milestones
 * - warn: Recoverable errors, fallbacks
 * 
 * @param {Object} options
 * @param {ActivityLogger} options.activityLogger - For forensic logging
 * @param {DebugLogger} options.debugLogger - For development logging
 */
export class MyFeature {
  // ...
}
```

## Best Practices

### Activity Logging Best Practices

1. **Always check for logger existence**: `if (this.activityLogger) { ... }`
2. **Use consistent event naming**: `feature_action` pattern
3. **Include timing data**: `duration_ms` for operations
4. **Structure data consistently**: Use the same JSON schema across similar events
5. **Log both success and failure**: Capture the complete story
6. **Pass session IDs correctly**: Use local session ID for correlation

### Debug Logging Best Practices

1. **Use appropriate log levels**: Don't log everything at `info`
2. **Include context**: Parameters, state, identifiers
3. **Keep messages concise**: But include enough detail for debugging
4. **Use consistent formatting**: Timestamps, component names
5. **Performance awareness**: Debug logging should be fast
6. **Fail gracefully**: Never crash because logging failed

### Integration Best Practices

1. **Pass loggers through constructors**: Don't create loggers in every class
2. **Test both systems independently**: Ensure isolation
3. **Handle logger failures**: Both systems should fail gracefully
4. **Document event schemas**: Make it easy for others to understand
5. **Use consistent session correlation**: Same session IDs across components

This logging system provides comprehensive visibility into Lace operations while maintaining high performance and reliability. Following these patterns ensures your new features integrate seamlessly with the existing logging infrastructure.
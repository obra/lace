# Error Propagation Implementation Plan

## Executive Summary

Currently, Lace's backend captures and logs errors from providers, tools, and agent operations, but these errors are never surfaced to the frontend. Users have no visibility into backend failures, making debugging and recovery impossible. This plan implements a comprehensive error propagation system that surfaces all backend errors to the UI through the existing SSE stream architecture.

## Current State Analysis

### Error Sources Identified
1. **Agent Errors**: Provider API failures, streaming errors, conversation processing failures, tool execution failures
2. **Already Partially Captured**: Agent class already emits `error` events, but they're not forwarded to frontend

### Current Architecture Analysis
- **Backend**: Agent emits `error` events (line 756 in agent.ts), but SessionService doesn't forward them
- **Event System**: Robust SSE streaming via EventStreamManager, ready for error events
- **Frontend**: Error boundaries and API error handling, but no backend error visibility  
- **Event Types**: 42 event types defined, but no error-specific events
- **Tool Architecture**: ToolExecutor instances per agent, return ToolResult with error status instead of emitting events
- **Provider Architecture**: Errors flow through Agent's provider response handling

### Architectural Context
- Event-sourced architecture with immutable event sequences
- SSE streaming via EventStreamManager with client-side filtering  
- React frontend with useEventStream hook for real-time updates
- Strongly-typed event system with discriminated unions
- **Key Discovery**: Agent ownership hierarchy handles error propagation - Tool → ToolExecutor → Agent → SessionService

## Design Alternatives Analysis

### Alternative 1: Logging-Based Error Capture
**Approach**: Intercept logger.error() calls and convert to events
**Pros**: Captures all existing errors without code changes
**Cons**: Unstructured, hard to categorize, loses context
**Decision**: Rejected - loses semantic meaning

### Alternative 2: Event-Based Error Propagation ⭐ RECOMMENDED  
**Approach**: Extend existing LaceEvent system with single AGENT_ERROR event type, enhance existing agent error emission
**Pros**: Leverages existing infrastructure, minimal changes, preserves context, follows ownership hierarchy
**Cons**: Requires enhancing existing error emission with more context
**Decision**: Selected - best architectural fit with minimal disruption

### Alternative 3: Separate Error Channel
**Approach**: Create dedicated error WebSocket/SSE endpoint
**Pros**: Clean separation of concerns
**Cons**: Duplicates infrastructure, complicates client-side handling
**Decision**: Rejected - over-engineering

### Alternative 4: HTTP Polling Error Log
**Approach**: REST endpoint that clients poll for recent errors
**Pros**: Simple to implement
**Cons**: Not real-time, poor user experience
**Decision**: Rejected - doesn't meet real-time requirements

## Implementation Plan

### Phase 1: Define Error Event Types

#### Task 1.1: Extend LaceEvent Types  
**Files**: `packages/core/src/threads/types.ts`

Add single error event type to EVENT_TYPES array:
```typescript
// Add to EVENT_TYPES array (line 42):
'AGENT_ERROR',
```

Add error data interface (simplified, unified approach):
```typescript
// Add after line 150:
interface AgentErrorData {
  errorType: 'provider_failure' | 'tool_execution' | 'processing_error' | 'timeout' | 'streaming_error';
  message: string;
  stack?: string;
  context: {
    phase: 'provider_response' | 'tool_execution' | 'conversation_processing' | 'initialization';
    // Available from Agent
    providerName?: string;        // From this.providerInstance?.providerName
    providerInstanceId?: string;  // From thread metadata  
    modelId?: string;            // From thread metadata
    // For tool-related errors
    toolName?: string;           // When phase === 'tool_execution'
    toolCallId?: string;         // When phase === 'tool_execution'
    // Additional context
    workingDirectory?: string;
    retryAttempt?: number;
  };
  isRetryable: boolean;
  retryCount?: number;
}
```

Update LaceEvent union type:
```typescript
// Add to LaceEvent union type (around line 200):
| {
    type: 'AGENT_ERROR';
    data: AgentErrorData;
  }
```

Update isTransientEventType function:
```typescript
// Add to isTransientEventType function (line 50):
'AGENT_ERROR',
```

**Testing**: 
- File: `packages/core/src/threads/types.test.ts`
- Test error event type validation
- Test isTransientEventType for error events
- Test error data interface validation

#### Task 1.2: Create Web Error Types
**Files**: `packages/web/types/web-events.ts`

Add error display interfaces:
```typescript
// Add after line 62:
export interface ErrorEntry extends TimelineEntry {
  type: 'error';
  errorType: 'provider_failure' | 'tool_execution' | 'processing_error' | 'timeout' | 'streaming_error';
  errorMessage: string;
  errorContext?: Record<string, unknown>;
  isRetryable: boolean;
  retryCount?: number;
  canRetry?: boolean;
  retryHandler?: () => void;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: Date;
  errorType: 'provider_failure' | 'tool_execution' | 'processing_error' | 'timeout' | 'streaming_error';
  severity: 'warning' | 'error' | 'critical';
  message: string;
  context: Record<string, unknown>;
  isRetryable: boolean;
  retryCount?: number;
  resolved: boolean;
  threadId?: string;
  sessionId?: string;
  providerName?: string;
  providerInstanceId?: string;
  modelId?: string;
}
```

**Testing**:
- File: `packages/web/types/web-events.test.ts`
- Test error entry interface validation
- Test error log entry interface validation

### Phase 2: Backend Error Capture

#### Task 2.1: Enhance Agent Error Emission  
**Files**: `packages/core/src/agents/agent.ts`

**CRITICAL REQUIREMENTS**:
- NO `any` types allowed - use proper TypeScript types
- NO mocking the functionality under test - use real implementations  
- Test-first approach - write failing tests before implementation
- NO backward compatibility - clean implementation

**Key Insight**: Agent already emits `error` events, but they lack context for UI display. Enhance existing error emission instead of creating new events.

**Location**: Line 756 (existing provider error handling)
```typescript
// ENHANCE existing error emission with structured data:
this.emit('error', {
  error: error instanceof Error ? error : new Error(String(error)),
  context: { 
    phase: 'provider_response', 
    threadId: this._threadId,
    // ADD: Enhanced context for error propagation
    errorType: 'provider_failure',
    providerName: this.providerInstance?.providerName,
    providerInstanceId: this.getInfo().providerInstanceId,
    modelId: this.getInfo().modelId,
    isRetryable: this.isRetryableError(error),
    retryCount: 0,
  },
});
```

**Location**: Line 832 (conversation processing error)  
```typescript
// ENHANCE existing error emission:
logger.error('AGENT: Unexpected error in conversation processing', {
  threadId: this._threadId,
  errorMessage: error instanceof Error ? error.message : String(error),
  errorStack: error instanceof Error ? error.stack : undefined,
});

// ADD: Emit enhanced error event
this.emit('error', {
  error: error instanceof Error ? error : new Error(String(error)),
  context: {
    phase: 'conversation_processing',
    threadId: this._threadId,
    errorType: 'processing_error',
    providerName: this.providerInstance?.providerName,
    providerInstanceId: this.getInfo().providerInstanceId,
    modelId: this.getInfo().modelId,
    isRetryable: false,
    retryCount: 0,
  },
});
```

**Location**: Line 1343 (tool execution error)
```typescript
// ENHANCE existing error logging with error emission:
logger.error('AGENT: Tool execution failed', {
  threadId: this._threadId,
  toolCallId: toolCall.id,
  toolName: toolCall.name,
  errorMessage: error instanceof Error ? error.message : String(error),
  errorStack: error instanceof Error ? error.stack : undefined,
});

// ADD: Emit error event for tool failures
this.emit('error', {
  error: error instanceof Error ? error : new Error(`Tool execution failed: ${error instanceof Error ? error.message : String(error)}`),
  context: {
    phase: 'tool_execution',
    threadId: this._threadId,
    errorType: 'tool_execution',
    toolName: toolCall.name,
    toolCallId: toolCall.id,
    providerName: this.providerInstance?.providerName,
    providerInstanceId: this.getInfo().providerInstanceId,
    modelId: this.getInfo().modelId,
    isRetryable: false,
    retryCount: 0,
  },
});
```

Add helper method:
```typescript
// Add after line 1570:
private isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors are typically retryable
    if (error.message.includes('network') || error.message.includes('timeout')) {
      return true;
    }
    // Rate limit errors are retryable  
    if (error.message.includes('rate limit') || error.message.includes('quota')) {
      return true;
    }
    // 5xx HTTP errors are retryable
    if (error.message.includes('500') || error.message.includes('502') || error.message.includes('503')) {
      return true;
    }
  }
  return false;
}
```

**Testing**:
- File: `packages/core/src/agents/agent-error-emission.test.ts` (NEW)
- Test enhanced error event emission for provider failures
- Test enhanced error event emission for processing errors
- Test enhanced error event emission for tool execution failures  
- Test isRetryableError logic for different error types
- Test error context preservation and structure
- NO mocking of agent functionality - use real agent instances
- Use test providers that can be configured to fail

#### Task 2.2: ~~Enhance ToolExecutor Error Reporting~~ (REMOVED)

**Key Insight**: ToolExecutor doesn't need to emit events. Tool errors already flow through Agent error handling at line 1343 where tool execution failures are caught and logged. This follows the ownership hierarchy: Tool → ToolExecutor → Agent.

The existing error flow is:
1. Tool execution fails in `executeToolDirect()` 
2. Error caught and returned as ToolResult with 'failed' status
3. Agent receives error ToolResult and emits error event (enhanced in Task 2.1)

**No changes needed to ToolExecutor** - it correctly returns error results that Agent handles.

#### Task 2.3: ~~Add Provider Error Forwarding~~ (REMOVED)

**Key Insight**: Provider errors are already captured in Agent class (Task 2.1, line 756). Agent handles provider calls and emits error events when providers fail. The ownership hierarchy is correct: Provider → Agent.

**No additional implementation needed** - provider errors flow through existing Agent error handling.

#### Task 2.4: ~~Implement System Error Capture~~ (REMOVED)

**Key Insight**: "System errors" are actually context-specific errors that should flow through their respective ownership hierarchies:
- Database errors → ThreadManager/ThreadPersistence → (if needed) through Agent
- File system errors → Tool execution → Agent error handling  
- Environment errors → Tool/Agent initialization → Agent error handling

Creating a global SystemErrorCapture would bypass the ownership hierarchy and lose important context.

**No additional implementation needed** - system-level errors should be handled at their point of occurrence and flow through existing hierarchies.

### Phase 3: Error Broadcasting

#### Task 3.1: Update EventStreamManager to Handle Agent Errors  
**Files**: `packages/web/lib/event-stream-manager.ts`

**Key Insight**: The implementer correctly enhanced Agent error emission but created an unnecessary `ErrorEventBridge` class. We should use the existing `EventStreamManager.registerSession()` pattern instead.

**FIRST: Delete the unnecessary bridge**
- Delete file: `packages/core/src/agents/error-event-bridge.ts`  
- Remove unused import and field from `packages/core/src/agents/agent.ts`:
  - Remove `import { ErrorEventBridge } from './error-event-bridge';`
  - Remove `private readonly _errorEventBridge: ErrorEventBridge;`

**SECOND: Add agent error handling to existing EventStreamManager**

**Location**: In `EventStreamManager.registerSession()` method, after existing task event handlers (around line 176)
```typescript
// Handle agent errors (same pattern as task events)
const agents = session.getAgents();
for (const agentInfo of agents) {
  const agent = session.getAgent(agentInfo.threadId);
  if (agent) {
    agent.on('error', (errorEvent: { error: Error; context: Record<string, unknown> }) => {
      const { error, context } = errorEvent;
      
      logger.debug(
        `[EVENT_STREAM] Agent ${agentInfo.threadId} error occurred, broadcasting AGENT_ERROR`
      );
      
      this.broadcast({
        type: 'AGENT_ERROR',
        threadId: agentInfo.threadId,
        timestamp: new Date(),
        data: {
          errorType: context.errorType as string,
          message: error.message,
          stack: error.stack,
          context: {
            phase: context.phase as string,
            providerName: context.providerName as string | undefined,
            providerInstanceId: context.providerInstanceId as string | undefined,
            modelId: context.modelId as string | undefined,
            toolName: context.toolName as string | undefined,
            toolCallId: context.toolCallId as string | undefined,
            workingDirectory: context.workingDirectory as string | undefined,
            retryAttempt: context.retryAttempt as number | undefined,
          },
          isRetryable: context.isRetryable as boolean,
          retryCount: context.retryCount as number,
        },
        transient: true,
        context: { 
          projectId, 
          sessionId, 
          agentId: agentInfo.threadId 
        },
      });
    });
  }
}
```

**Why This Approach**:
- Follows existing pattern used for task events and agent spawning
- Uses existing `registerSession()` method that SessionService already calls
- No new bridge classes - leverages existing EventStreamManager bridge
- Consistent with how all other system events work

**Testing**:
- File: `packages/web/lib/event-stream-manager-agent-errors.test.ts` (NEW)
- Test agent error event forwarding through EventStreamManager
- Test error event broadcasting to SSE stream  
- Test error context extraction and structure
- Use real session instances with real agents
- Verify error events reach frontend with correct data structure

#### Task 3.2: ~~Ensure EventStreamManager Handles Error Events~~ (MINIMAL CHANGES)

**Key Insight**: EventStreamManager already handles all LaceEvent types generically. AGENT_ERROR events will automatically work without changes.

**Optional Enhancement**: Add specific logging for error events:

**Location**: After line 265 (in broadcast method)
```typescript
// Optional: Add debug logging for error events
if (fullEvent.type === 'AGENT_ERROR') {
  logger.info(`[EVENT_STREAM] Broadcasting AGENT_ERROR event`, {
    errorType: (fullEvent.data as { errorType?: string }).errorType,
    message: (fullEvent.data as { message?: string }).message,
    threadId: fullEvent.threadId,
    connectionCount: this.connections.size,
  });
}
```

**Testing**: 
- Extend existing EventStreamManager tests to include AGENT_ERROR events
- No new functionality needed - just verify existing broadcast works

#### Task 3.3: ~~Add Error Serialization with SuperJSON~~ (REMOVED)

**Key Insight**: SuperJSON already handles Error serialization correctly. The error objects in our AGENT_ERROR events are plain objects, not Error instances, so standard JSON serialization works fine.

**No additional implementation needed** - existing serialization handles our error data structure.

### Phase 4: Frontend Error Display

#### Task 4.1: Extend useEventStream Hook
**Files**: `packages/web/hooks/useEventStream.ts`

Add error event handlers to EventHandlers interface:

**Location**: After line 100 (existing event handlers)
```typescript
// Error event handlers
onAgentError?: (event: LaceEvent) => void;
onError?: (event: LaceEvent) => void; // Generic error handler
```

Add error event processing in the hook implementation:

**Location**: In the event processing section (around line 200)
```typescript
// Add error event handling
case 'AGENT_ERROR':
  handlers.onAgentError?.(event);
  handlers.onError?.(event);
  break;
```


**Testing**:
- File: `packages/web/hooks/useEventStream-errors.test.ts` (NEW)
- Test AGENT_ERROR event handler registration
- Test error event processing  
- Test generic error handler invocation
- Use React Testing Library and real EventSource mocks

#### Task 4.2: Create Error Display Components
**Files**: 
- `packages/web/components/errors/ErrorDisplay.tsx` (NEW)
- `packages/web/components/errors/ErrorLogEntry.tsx` (NEW)
- `packages/web/components/errors/ErrorToast.tsx` (NEW)

**ErrorDisplay.tsx**:
```tsx
// ABOUTME: Display component for error events in timeline and error log
// ABOUTME: Shows error details, context, and recovery actions with DaisyUI styling

import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faExclamationTriangle, faRedo, faInfo } from '@fortawesome/free-solid-svg-icons';
import type { ErrorLogEntry } from '@/types/web-events';

interface ErrorDisplayProps {
  error: ErrorLogEntry;
  showContext?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function ErrorDisplay({ 
  error, 
  showContext = true, 
  onRetry, 
  onDismiss, 
  compact = false 
}: ErrorDisplayProps): React.JSX.Element {
  const getErrorIcon = () => {
    switch (error.severity) {
      case 'critical': return faExclamationTriangle;
      case 'error': return faExclamationTriangle;
      case 'warning': return faInfo;
      default: return faInfo;
    }
  };

  const getAlertClass = () => {
    switch (error.severity) {
      case 'critical': return 'alert-error';
      case 'error': return 'alert-error';
      case 'warning': return 'alert-warning';
      default: return 'alert-info';
    }
  };

  return (
    <div className={`alert ${getAlertClass()} ${compact ? 'alert-sm' : ''}`}>
      <FontAwesomeIcon icon={getErrorIcon()} className="text-lg" />
      
      <div className="flex-1">
        <div className="font-medium">
          {error.errorType.toUpperCase()}: {error.message}
        </div>
        
        {showContext && Object.keys(error.context).length > 0 && (
          <div className="text-sm opacity-80 mt-1">
            <details className="collapse collapse-arrow">
              <summary className="collapse-title text-xs p-0">
                Show context
              </summary>
              <div className="collapse-content p-0 pt-2">
                <pre className="text-xs bg-base-200 p-2 rounded">
                  {JSON.stringify(error.context, null, 2)}
                </pre>
              </div>
            </details>
          </div>
        )}
        
        <div className="text-xs opacity-60 mt-1">
          {error.timestamp.toLocaleTimeString()}
        </div>
      </div>

      <div className="flex gap-2">
        {error.isRetryable && onRetry && (
          <button 
            className="btn btn-xs btn-outline btn-primary"
            onClick={onRetry}
          >
            <FontAwesomeIcon icon={faRedo} className="mr-1" />
            Retry
          </button>
        )}
        
        {onDismiss && (
          <button 
            className="btn btn-xs btn-ghost"
            onClick={onDismiss}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
```

**ErrorLogEntry.tsx**:
```tsx
// ABOUTME: Individual error entry in the error log with expand/collapse functionality
// ABOUTME: Shows full error details including stack traces and retry history

import React, { useState } from 'react';
import { ErrorDisplay } from './ErrorDisplay';
import type { ErrorLogEntry as ErrorLogEntryType } from '@/types/web-events';

interface ErrorLogEntryProps {
  error: ErrorLogEntryType;
  onRetry?: () => void;
  onResolve?: () => void;
}

export function ErrorLogEntry({ error, onRetry, onResolve }: ErrorLogEntryProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card bg-base-100 shadow-sm border border-base-200 mb-2">
      <div className="card-body p-3">
        <ErrorDisplay 
          error={error}
          showContext={false}
          onRetry={onRetry}
          compact
        />
        
        <div className="flex gap-2 mt-2">
          <button 
            className="btn btn-xs btn-ghost"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Less' : 'More'} details
          </button>
          
          {!error.resolved && onResolve && (
            <button 
              className="btn btn-xs btn-outline btn-success"
              onClick={onResolve}
            >
              Mark resolved
            </button>
          )}
        </div>
        
        {expanded && (
          <div className="mt-2 space-y-2">
            <div>
              <div className="text-xs font-medium text-base-content/60">Context:</div>
              <pre className="text-xs bg-base-200 p-2 rounded overflow-x-auto">
                {JSON.stringify(error.context, null, 2)}
              </pre>
            </div>
            
            {error.retryCount && error.retryCount > 0 && (
              <div>
                <div className="text-xs font-medium text-base-content/60">
                  Retry attempts: {error.retryCount}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**ErrorToast.tsx**:
```tsx
// ABOUTME: Toast notification for real-time error events
// ABOUTME: Provides immediate user feedback when errors occur

import React, { useEffect, useState } from 'react';
import { ErrorDisplay } from './ErrorDisplay';
import type { ErrorLogEntry } from '@/types/web-events';

interface ErrorToastProps {
  error: ErrorLogEntry;
  duration?: number; // milliseconds
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorToast({ 
  error, 
  duration = 5000, 
  onDismiss, 
  onRetry 
}: ErrorToastProps): React.JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  if (!visible) return <></>;

  return (
    <div className="toast toast-top toast-end z-50">
      <ErrorDisplay
        error={error}
        showContext={false}
        onRetry={onRetry}
        onDismiss={handleDismiss}
        compact
      />
    </div>
  );
}
```

**Testing**:
- File: `packages/web/components/errors/ErrorDisplay.test.tsx` (NEW)
- File: `packages/web/components/errors/ErrorLogEntry.test.tsx` (NEW)  
- File: `packages/web/components/errors/ErrorToast.test.tsx` (NEW)
- Test component rendering for different error types
- Test retry button functionality
- Test context display/hide
- Test toast auto-dismiss behavior
- Use React Testing Library and proper TypeScript types

#### Task 4.3: Add Error Log UI
**Files**: `packages/web/components/errors/ErrorLog.tsx` (NEW)

Create a dedicated error log component:

```tsx
// ABOUTME: Error log interface showing recent and filtered error events
// ABOUTME: Provides error search, filtering, and bulk actions

import React, { useState, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFilter, faTrash, faRefresh } from '@fortawesome/free-solid-svg-icons';
import { ErrorLogEntry } from './ErrorLogEntry';
import type { ErrorLogEntry as ErrorLogEntryType } from '@/types/web-events';

interface ErrorLogProps {
  errors: ErrorLogEntryType[];
  onRetryError?: (errorId: string) => void;
  onResolveError?: (errorId: string) => void;
  onClearResolved?: () => void;
  onRefresh?: () => void;
}

export function ErrorLog({ 
  errors, 
  onRetryError, 
  onResolveError, 
  onClearResolved,
  onRefresh 
}: ErrorLogProps): React.JSX.Element {
  const [filter, setFilter] = useState<'all' | 'unresolved' | 'retryable'>('unresolved');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'error' | 'warning'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'agent' | 'tool' | 'provider' | 'system'>('all');

  const filteredErrors = useMemo(() => {
    return errors.filter(error => {
      // Status filter
      if (filter === 'unresolved' && error.resolved) return false;
      if (filter === 'retryable' && !error.isRetryable) return false;

      // Severity filter
      if (severityFilter !== 'all' && error.severity !== severityFilter) return false;

      // Type filter  
      if (typeFilter !== 'all' && error.errorType !== typeFilter) return false;

      return true;
    });
  }, [errors, filter, severityFilter, typeFilter]);

  const unresolvedCount = errors.filter(e => !e.resolved).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-base-200">
        <div>
          <h2 className="text-lg font-semibold">Error Log</h2>
          <div className="text-sm text-base-content/60">
            {unresolvedCount} unresolved, {errors.length} total
          </div>
        </div>
        
        <div className="flex gap-2">
          {onClearResolved && (
            <button 
              className="btn btn-sm btn-ghost"
              onClick={onClearResolved}
            >
              <FontAwesomeIcon icon={faTrash} className="mr-2" />
              Clear Resolved
            </button>
          )}
          
          {onRefresh && (
            <button 
              className="btn btn-sm btn-primary"
              onClick={onRefresh}
            >
              <FontAwesomeIcon icon={faRefresh} className="mr-2" />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="p-4 border-b border-base-200 bg-base-50">
        <div className="flex flex-wrap gap-4">
          <div className="form-control">
            <label className="label label-text text-xs">Status</label>
            <select 
              className="select select-xs select-bordered"
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
            >
              <option value="all">All</option>
              <option value="unresolved">Unresolved</option>
              <option value="retryable">Retryable</option>
            </select>
          </div>

          <div className="form-control">
            <label className="label label-text text-xs">Severity</label>
            <select 
              className="select select-xs select-bordered"
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}
            >
              <option value="all">All</option>
              <option value="critical">Critical</option>
              <option value="error">Error</option>
              <option value="warning">Warning</option>
            </select>
          </div>

          <div className="form-control">
            <label className="label label-text text-xs">Type</label>
            <select 
              className="select select-xs select-bordered"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            >
              <option value="all">All</option>
              <option value="agent">Agent</option>
              <option value="tool">Tool</option>
              <option value="provider">Provider</option>
              <option value="system">System</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error List */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredErrors.length === 0 ? (
          <div className="text-center text-base-content/60 py-8">
            No errors match the current filters
          </div>
        ) : (
          <div className="space-y-2">
            {filteredErrors.map(error => (
              <ErrorLogEntry
                key={error.id}
                error={error}
                onRetry={() => onRetryError?.(error.id)}
                onResolve={() => onResolveError?.(error.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Testing**:
- File: `packages/web/components/errors/ErrorLog.test.tsx` (NEW)
- Test error filtering by status, severity, and type
- Test bulk actions (clear resolved, refresh)
- Test empty states
- Test error retry and resolve actions

#### Task 4.4: Integrate Errors into Timeline
**Files**: `packages/web/components/timeline/TimelineProcessor.tsx` (or equivalent timeline processing file)

The timeline needs to display error events as timeline entries. Find the main timeline processing logic and add error event handling:

**Location**: In the event-to-timeline-entry conversion logic
```typescript
// Add error event processing
case 'AGENT_ERROR': {
  const errorData = event.data as {
    errorType: string;
    message: string;
    context: Record<string, unknown>;
    isRetryable: boolean;
  };
  
  return {
    id: event.id || `error-${Date.now()}`,
    type: 'error',
    content: errorData.message,
    timestamp: event.timestamp || new Date(),
    eventType: event.type,
    metadata: {
      errorType: errorData.errorType,
      context: errorData.context,
      isRetryable: errorData.isRetryable,
    },
  } satisfies TimelineEntry;
}
```


**Testing**:
- File: `packages/web/components/timeline/TimelineProcessor-errors.test.tsx` (NEW)
- Test AGENT_ERROR event to timeline entry conversion
- Test error timeline entry rendering
- Test error context display in timeline

### Phase 5: Error Recovery

#### Task 5.1: Add Retry Mechanisms
**Files**: 
- `packages/web/hooks/useErrorRecovery.ts` (NEW)
- `packages/core/src/agents/retry-manager.ts` (NEW)

**useErrorRecovery.ts**:
```typescript
// ABOUTME: Hook for handling error recovery actions like retry and resolution
// ABOUTME: Manages retry state and communicates with backend for error recovery

import { useState, useCallback } from 'react';
import { useSessionAPI } from './useSessionAPI';

interface RetryState {
  retrying: boolean;
  lastRetryAt?: Date;
  retryCount: number;
}

export function useErrorRecovery(sessionId: string) {
  const [retryStates, setRetryStates] = useState<Record<string, RetryState>>({});
  const sessionAPI = useSessionAPI(sessionId);

  const retryAgentOperation = useCallback(async (
    threadId: string,
    errorType: 'provider_failure' | 'processing_error' | 'streaming_error' | 'timeout'
  ): Promise<boolean> => {
    const currentState = retryStates[threadId] || { retrying: false, retryCount: 0 };
    
    if (currentState.retrying) {
      return false; // Already retrying
    }

    setRetryStates(prev => ({
      ...prev,
      [threadId]: {
        ...currentState,
        retrying: true,
        lastRetryAt: new Date(),
      },
    }));

    try {
      // Call backend retry endpoint
      const result = await sessionAPI.retryAgent(threadId, errorType);
      
      setRetryStates(prev => ({
        ...prev,
        [threadId]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentState.retryCount + 1,
        },
      }));

      return result.success;
    } catch (error) {
      setRetryStates(prev => ({
        ...prev,
        [threadId]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentState.retryCount + 1,
        },
      }));
      return false;
    }
  }, [retryStates, sessionAPI]);

  const retryToolOperation = useCallback(async (
    threadId: string,
    toolCallId: string,
    toolName: string
  ): Promise<boolean> => {
    const key = `${threadId}-${toolCallId}`;
    const currentState = retryStates[key] || { retrying: false, retryCount: 0 };
    
    if (currentState.retrying) {
      return false;
    }

    setRetryStates(prev => ({
      ...prev,
      [key]: {
        ...currentState,
        retrying: true,
        lastRetryAt: new Date(),
      },
    }));

    try {
      const result = await sessionAPI.retryTool(threadId, toolCallId, toolName);
      
      setRetryStates(prev => ({
        ...prev,
        [key]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentState.retryCount + 1,
        },
      }));

      return result.success;
    } catch (error) {
      setRetryStates(prev => ({
        ...prev,
        [key]: {
          retrying: false,
          lastRetryAt: new Date(),
          retryCount: currentState.retryCount + 1,
        },
      }));
      return false;
    }
  }, [retryStates, sessionAPI]);

  return {
    retryStates,
    retryAgentOperation,
    retryToolOperation,
  };
}
```

**retry-manager.ts**:
```typescript
// ABOUTME: Backend retry coordination for failed operations
// ABOUTME: Handles agent and tool retry logic with exponential backoff

export class RetryManager {
  private retryAttempts = new Map<string, number>();
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 1000; // 1 second

  async retryAgentOperation(
    agent: Agent,
    errorType: 'provider_failure' | 'processing_error' | 'streaming_error' | 'timeout'
  ): Promise<{ success: boolean; error?: string }> {
    const key = `agent-${agent.threadId}-${errorType}`;
    const currentAttempts = this.retryAttempts.get(key) || 0;

    if (currentAttempts >= this.MAX_RETRIES) {
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    // Calculate exponential backoff delay
    const delay = this.BASE_DELAY * Math.pow(2, currentAttempts);
    await new Promise(resolve => setTimeout(resolve, delay));

    this.retryAttempts.set(key, currentAttempts + 1);

    try {
      switch (errorType) {
        case 'provider_failure':
          // Retry the last conversation turn
          await agent.processQueuedMessages();
          break;
        
        case 'processing_error':
          // Restart conversation processing
          await agent.processQueuedMessages();
          break;
          
        case 'streaming_error':
          // Retry with non-streaming mode
          // Implementation depends on Agent streaming API
          break;
          
        case 'timeout':
          // Retry with extended timeout
          // Implementation depends on provider timeout configuration
          break;
      }

      // Reset retry count on success
      this.retryAttempts.delete(key);
      return { success: true };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Retry failed' 
      };
    }
  }

  async retryToolOperation(
    toolExecutor: ToolExecutor,
    toolCall: ToolCall,
    context: ToolContext
  ): Promise<{ success: boolean; result?: ToolResult; error?: string }> {
    const key = `tool-${toolCall.id}`;
    const currentAttempts = this.retryAttempts.get(key) || 0;

    if (currentAttempts >= this.MAX_RETRIES) {
      return { success: false, error: 'Maximum retry attempts exceeded' };
    }

    const delay = this.BASE_DELAY * Math.pow(2, currentAttempts);
    await new Promise(resolve => setTimeout(resolve, delay));

    this.retryAttempts.set(key, currentAttempts + 1);

    try {
      const result = await toolExecutor.executeApprovedTool(toolCall, context);
      
      if (result.error) {
        return { success: false, error: result.error };
      }

      this.retryAttempts.delete(key);
      return { success: true, result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Tool retry failed'
      };
    }
  }

  clearRetryHistory(key?: string): void {
    if (key) {
      this.retryAttempts.delete(key);
    } else {
      this.retryAttempts.clear();
    }
  }
}
```

**Testing**:
- File: `packages/web/hooks/useErrorRecovery.test.ts` (NEW)
- File: `packages/core/src/agents/retry-manager.test.ts` (NEW)
- Test retry state management
- Test retry API calls
- Test exponential backoff logic
- Test maximum retry limits
- Use real implementations, no mocks of retry logic

#### Task 5.2: Implement Error Context Display
**Files**: `packages/web/components/errors/ErrorContext.tsx` (NEW)

Create detailed error context display:

```tsx
// ABOUTME: Detailed error context display with technical information
// ABOUTME: Shows stack traces, environment context, and related events

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp, faCopy } from '@fortawesome/free-solid-svg-icons';

interface ErrorContextProps {
  context: Record<string, unknown>;
  stack?: string;
  errorType: string;
  component?: string;
}

export function ErrorContext({ 
  context, 
  stack, 
  errorType, 
  component 
}: ErrorContextProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [stackExpanded, setStackExpanded] = useState(false);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Could add a toast notification here
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    }
  };

  const contextString = JSON.stringify(context, null, 2);
  const debugInfo = JSON.stringify({
    errorType,
    component,
    timestamp: new Date().toISOString(),
    context,
    stack,
  }, null, 2);

  return (
    <div className="space-y-2">
      {/* Context Toggle */}
      <button
        className="btn btn-xs btn-ghost w-full justify-between"
        onClick={() => setExpanded(!expanded)}
      >
        <span>Error Context</span>
        <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="font-medium text-base-content/60">Type:</div>
              <div className="font-mono">{errorType}</div>
            </div>
            {component && (
              <div>
                <div className="font-medium text-base-content/60">Component:</div>
                <div className="font-mono">{component}</div>
              </div>
            )}
          </div>

          {/* Context Data */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <div className="font-medium text-base-content/60 text-xs">Context:</div>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => copyToClipboard(contextString)}
                title="Copy context to clipboard"
              >
                <FontAwesomeIcon icon={faCopy} />
              </button>
            </div>
            <pre className="text-xs bg-base-200 p-2 rounded overflow-x-auto max-h-40">
              {contextString}
            </pre>
          </div>

          {/* Stack Trace */}
          {stack && (
            <div>
              <button
                className="btn btn-xs btn-ghost w-full justify-between mb-1"
                onClick={() => setStackExpanded(!stackExpanded)}
              >
                <span className="font-medium text-base-content/60">Stack Trace</span>
                <FontAwesomeIcon icon={stackExpanded ? faChevronUp : faChevronDown} />
              </button>
              
              {stackExpanded && (
                <div className="relative">
                  <button
                    className="absolute top-2 right-2 btn btn-xs btn-ghost"
                    onClick={() => copyToClipboard(stack)}
                    title="Copy stack trace to clipboard"
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                  <pre className="text-xs bg-base-200 p-2 rounded overflow-x-auto max-h-60">
                    {stack}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Debug Info */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <div className="font-medium text-base-content/60 text-xs">Full Debug Info:</div>
              <button
                className="btn btn-xs btn-ghost"
                onClick={() => copyToClipboard(debugInfo)}
                title="Copy all debug info to clipboard"
              >
                <FontAwesomeIcon icon={faCopy} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Testing**:
- File: `packages/web/components/errors/ErrorContext.test.tsx` (NEW)
- Test context expansion/collapse
- Test stack trace display
- Test clipboard functionality
- Test context formatting

#### Task 5.3: Add User Recovery Actions
**Files**: `packages/web/components/errors/ErrorActions.tsx` (NEW)

Create error action buttons:

```tsx
// ABOUTME: Action buttons for error recovery including retry, report, and dismiss
// ABOUTME: Handles different error types with appropriate recovery options

import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { 
  faRedo, 
  faFlag, 
  faEye, 
  faEyeSlash, 
  faExternalLinkAlt 
} from '@fortawesome/free-solid-svg-icons';

interface ErrorActionsProps {
  errorId: string;
  errorType: 'agent' | 'tool' | 'provider' | 'system';
  isRetryable: boolean;
  retryCount?: number;
  onRetry?: () => Promise<boolean>;
  onReport?: () => void;
  onDismiss?: () => void;
  onViewLogs?: () => void;
  threadId?: string;
  sessionId?: string;
}

export function ErrorActions({
  errorId,
  errorType,
  isRetryable,
  retryCount = 0,
  onRetry,
  onReport,
  onDismiss,
  onViewLogs,
  threadId,
  sessionId,
}: ErrorActionsProps): React.JSX.Element {
  const [retrying, setRetrying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || retrying) return;

    setRetrying(true);
    try {
      const success = await onRetry();
      if (success) {
        setDismissed(true);
      }
    } finally {
      setRetrying(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  const getRetryButtonText = () => {
    if (retrying) return 'Retrying...';
    if (retryCount > 0) return `Retry (${retryCount + 1})`;
    return 'Retry';
  };

  const getActionSuggestion = () => {
    switch (errorType) {
      case 'provider':
        return 'Check your API keys and rate limits';
      case 'tool':
        return 'Verify file permissions and paths';
      case 'agent':
        return 'Review conversation context';
      case 'system':
        return 'Check system resources and connectivity';
      default:
        return 'Review error details for recovery steps';
    }
  };

  if (dismissed) return <></>;

  return (
    <div className="space-y-2">
      {/* Main Actions */}
      <div className="flex gap-2 flex-wrap">
        {isRetryable && onRetry && (
          <button
            className={`btn btn-sm ${retrying ? 'loading' : ''} btn-primary`}
            onClick={handleRetry}
            disabled={retrying || retryCount >= 3}
          >
            {!retrying && <FontAwesomeIcon icon={faRedo} className="mr-2" />}
            {getRetryButtonText()}
          </button>
        )}

        {onViewLogs && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={onViewLogs}
          >
            <FontAwesomeIcon icon={faExternalLinkAlt} className="mr-2" />
            View Logs
          </button>
        )}

        {onReport && (
          <button
            className="btn btn-sm btn-outline btn-warning"
            onClick={onReport}
          >
            <FontAwesomeIcon icon={faFlag} className="mr-2" />
            Report
          </button>
        )}

        <button
          className="btn btn-sm btn-ghost"
          onClick={handleDismiss}
        >
          <FontAwesomeIcon icon={faEyeSlash} className="mr-2" />
          Dismiss
        </button>
      </div>

      {/* Action Suggestion */}
      <div className="text-xs text-base-content/60">
        💡 {getActionSuggestion()}
      </div>

      {/* Retry Limit Warning */}
      {isRetryable && retryCount >= 2 && (
        <div className="alert alert-warning alert-sm">
          <FontAwesomeIcon icon={faEye} />
          <span className="text-xs">
            Maximum retries will be reached after next attempt
          </span>
        </div>
      )}
    </div>
  );
}
```

**Testing**:
- File: `packages/web/components/errors/ErrorActions.test.tsx` (NEW)
- Test retry button behavior and loading states
- Test retry limit enforcement
- Test action button visibility based on error type
- Test dismiss functionality

#### Task 5.4: Create Error Notification System
**Files**: `packages/web/hooks/useErrorNotifications.ts` (NEW)

Create a notification system for error events:

```typescript
// ABOUTME: Hook for managing error notifications and toast displays
// ABOUTME: Handles error event subscription and notification state management

import { useEffect, useState, useCallback } from 'react';
import { useEventStream } from './useEventStream';
import type { LaceEvent, ErrorLogEntry } from '@/types/core';

interface ErrorNotificationConfig {
  showToasts: boolean;
  toastDuration: number;
  maxToasts: number;
  severity: 'all' | 'error' | 'critical';
  types: ('agent' | 'tool' | 'provider' | 'system')[];
}

interface ActiveNotification extends ErrorLogEntry {
  id: string;
  showToast: boolean;
}

export function useErrorNotifications(
  sessionId: string,
  config: ErrorNotificationConfig = {
    showToasts: true,
    toastDuration: 5000,
    maxToasts: 3,
    severity: 'all',
    types: ['agent', 'tool', 'provider', 'system'],
  }
) {
  const [notifications, setNotifications] = useState<ActiveNotification[]>([]);
  const [errorLog, setErrorLog] = useState<ErrorLogEntry[]>([]);

  const addError = useCallback((event: LaceEvent) => {
    const errorData = event.data as {
      errorType: string;
      message: string;
      context: Record<string, unknown>;
      isRetryable: boolean;
      retryCount?: number;
    };

    const severity = errorData.errorType.includes('critical') ? 'critical' : 
                    errorData.errorType.includes('error') ? 'error' : 'warning';
    
    const errorType = event.type.includes('AGENT') ? 'agent' :
                     event.type.includes('TOOL') ? 'tool' :
                     event.type.includes('PROVIDER') ? 'provider' : 'system';

    // Filter based on config
    if (config.severity !== 'all' && severity !== config.severity) return;
    if (!config.types.includes(errorType)) return;

    const errorEntry: ActiveNotification = {
      id: event.id || `error-${Date.now()}`,
      timestamp: event.timestamp || new Date(),
      errorType,
      severity,
      message: errorData.message,
      context: errorData.context,
      isRetryable: errorData.isRetryable,
      retryCount: errorData.retryCount || 0,
      resolved: false,
      threadId: event.threadId,
      sessionId,
      showToast: config.showToasts,
    };

    // Add to error log
    setErrorLog(prev => [errorEntry, ...prev].slice(0, 1000)); // Keep last 1000 errors

    // Add to notifications if toasts are enabled
    if (config.showToasts) {
      setNotifications(prev => {
        const newNotifications = [errorEntry, ...prev].slice(0, config.maxToasts);
        return newNotifications;
      });
    }
  }, [sessionId, config]);

  const dismissNotification = useCallback((notificationId: string) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const resolveError = useCallback((errorId: string) => {
    setErrorLog(prev => 
      prev.map(error => 
        error.id === errorId ? { ...error, resolved: true } : error
      )
    );
    dismissNotification(errorId);
  }, [dismissNotification]);

  const clearResolvedErrors = useCallback(() => {
    setErrorLog(prev => prev.filter(error => !error.resolved));
  }, []);

  // Subscribe to error events
  useEventStream({
    onAgentError: addError,
    onToolError: addError,
    onProviderError: addError,
    onSystemError: addError,
  });

  return {
    notifications,
    errorLog,
    dismissNotification,
    resolveError,
    clearResolvedErrors,
  };
}
```

**Testing**:
- File: `packages/web/hooks/useErrorNotifications.test.ts` (NEW)
- Test error event subscription and processing
- Test notification filtering by severity and type
- Test toast management and limits
- Test error log state management
- Test dismiss and resolve functionality

### Phase 6: Testing & Documentation

#### Task 6.1: Write Comprehensive Tests
**Files**: Multiple test files as specified in previous tasks

**Testing Strategy**:
- **Unit Tests**: Test individual components and hooks in isolation
- **Integration Tests**: Test error flow from backend emission to frontend display
- **E2E Tests**: Test complete error scenarios with real backend/frontend interaction

**Key Testing Requirements**:
- NO `any` types in test code - use proper TypeScript types
- NO mocking of functionality under test - use real implementations
- Test-first approach - write failing tests before implementing features
- Use React Testing Library for component tests
- Use Vitest for backend tests
- Create predictably failing scenarios instead of mocks

**Error Flow Integration Test**:
```typescript
// File: packages/web/e2e/error-propagation.e2e.ts (NEW)
import { test, expect } from '@playwright/test';

test('error propagation flow', async ({ page }) => {
  // Navigate to app
  await page.goto('/');
  
  // Start a session that will trigger errors
  await page.click('[data-testid="start-session"]');
  
  // Trigger an agent error by using a broken provider
  await page.click('[data-testid="trigger-provider-error"]');
  
  // Verify error appears in timeline
  await expect(page.locator('[data-testid="timeline-error"]')).toBeVisible();
  
  // Verify error toast appears
  await expect(page.locator('[data-testid="error-toast"]')).toBeVisible();
  
  // Open error log
  await page.click('[data-testid="open-error-log"]');
  
  // Verify error appears in log
  await expect(page.locator('[data-testid="error-log-entry"]')).toBeVisible();
  
  // Test retry functionality
  await page.click('[data-testid="retry-error"]');
  
  // Verify retry attempt is recorded
  await expect(page.locator('[data-testid="retry-count"]')).toContainText('1');
});
```

#### Task 6.2: Add E2E Tests for Error Scenarios
**Files**: 
- `packages/web/e2e/agent-errors.e2e.ts` (NEW)
- `packages/web/e2e/tool-errors.e2e.ts` (NEW)
- `packages/web/e2e/provider-errors.e2e.ts` (NEW)

Create comprehensive E2E tests covering:
- Provider API failures and retries
- Tool execution errors and recovery
- Agent processing errors
- Error notification and display
- Error log functionality
- Retry mechanisms

#### Task 6.3: Update Documentation
**Files**:
- `packages/web/components/errors/README.md` (NEW)
- `docs/architecture/ERROR-HANDLING.md` (NEW) 
- Update existing component documentation

**Error Handling Documentation**:
```markdown
# Error Handling Architecture

## Overview
Lace implements comprehensive error propagation from backend to frontend, providing users with visibility into all system errors and recovery options.

## Error Types
- **Agent Errors**: Provider failures, processing errors, streaming issues
- **Tool Errors**: Execution failures, validation errors, permission issues  
- **Provider Errors**: API errors, authentication failures, rate limits
- **System Errors**: Database failures, resource limitations

## Error Flow
1. Error occurs in backend component
2. Error event emitted with structured data
3. SessionService forwards error to EventStreamManager
4. Frontend receives error via SSE stream
5. UI displays error in timeline and notifications
6. User can retry, dismiss, or view details

## Component Usage
```tsx
import { useErrorNotifications } from '@/hooks/useErrorNotifications';
import { ErrorLog } from '@/components/errors/ErrorLog';

function MyComponent() {
  const { notifications, errorLog } = useErrorNotifications(sessionId);
  
  return (
    <>
      {notifications.map(error => (
        <ErrorToast key={error.id} error={error} />
      ))}
      <ErrorLog errors={errorLog} />
    </>
  );
}
```
```

#### Task 6.4: Add Error Handling Guidelines
**Files**: `docs/development/ERROR-HANDLING-GUIDELINES.md` (NEW)

Create developer guidelines for proper error handling:

```markdown
# Error Handling Guidelines

## Adding New Error Types
1. Define error data interface in `packages/core/src/threads/types.ts`
2. Add event type to `EVENT_TYPES` array
3. Add emission logic in relevant component
4. Update frontend error processing

## Error Emission Best Practices
- Always include structured context data
- Set `isRetryable` flag appropriately  
- Include retry count for tracking attempts
- Use consistent error type naming

## Frontend Error Display
- Use ErrorDisplay component for consistency
- Provide appropriate recovery actions
- Show contextual information
- Handle loading and error states

## Testing Requirements
- Write tests before implementation
- Use real implementations, not mocks
- Test error recovery flows
- Verify error context preservation
```


## Success Criteria

### Functional Requirements ✅
- [ ] All backend agent errors visible in frontend
- [ ] Real-time error notifications via SSE  
- [ ] Error log with filtering and search
- [ ] Retry mechanisms for retryable errors
- [ ] Error context and stack trace display
- [ ] Timeline integration for error events

### Technical Requirements ✅
- [ ] No `any` types used anywhere
- [ ] No mocks of functionality under test
- [ ] Single AGENT_ERROR event type strongly typed
- [ ] Comprehensive test coverage >90%
- [ ] Performance: <100ms error event latency
- [ ] Memory: Error log bounded to prevent leaks
- [ ] **Architecture Alignment**: Follow existing ownership hierarchy (Tool → ToolExecutor → Agent → SessionService)

### User Experience ✅
- [ ] Clear error descriptions for users
- [ ] Appropriate recovery actions for provider/tool failures
- [ ] Non-disruptive error notifications  
- [ ] Error resolution tracking
- [ ] Contextual help for error types

## Risk Mitigation

### Technical Risks
- **Event ordering issues**: Use existing event sequence guarantees
- **Performance impact**: Batch error events and limit notifications
- **Memory leaks**: Bound error log size and clean up resolved errors
- **Type safety**: Comprehensive TypeScript coverage and runtime validation

### UX Risks  
- **Error notification fatigue**: Smart filtering and grouping
- **Information overload**: Progressive disclosure and contextual information
- **Recovery confusion**: Clear action guidance and inline help

## Notes for Implementation

### DO:
- Follow existing architectural patterns
- Use strongly-typed interfaces throughout
- Write tests first before implementation
- Provide clear error context and recovery options
- Use existing UI components and styling

### DON'T:
- Use `any` types anywhere in the implementation
- Mock functionality under test - use real implementations
- Add backward compatibility - this is clean new architecture  
- Ignore error context - always preserve debugging information
- Create notification spam - implement smart filtering

## Architecture Overview

### Error Flow
```
Error Occurs → Agent.emit('error', enhancedContext) → SessionService → EventStreamManager → Frontend
```

This plan provides comprehensive error visibility while maintaining Lace's high code quality standards and architectural consistency. The implementation leverages existing infrastructure and follows established ownership patterns for maximum reliability and maintainability.
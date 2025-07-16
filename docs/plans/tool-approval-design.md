# Web UI Tool Approval System Design (REVISED)

## Overview

This document outlines the design for an interactive tool approval system in the Lace web UI, allowing users to approve or deny tool executions in real-time through a modal interface.

## Architecture

### 1. Event Flow

```
Agent needs approval → Emit SSE event → Frontend shows modal → User decides → 
API call with decision → Resolve approval callback → Agent continues
```

### 2. Key Components

#### 2.1 Event Types

**New SSE Event Type:**
```typescript
interface ToolApprovalRequest {
  type: 'TOOL_APPROVAL_REQUEST';
  threadId: ThreadId;
  timestamp: string;
  data: {
    requestId: string;          // Unique ID to track this approval
    toolName: string;           // e.g., "file-write"
    toolDescription?: string;   // Human-readable description
    isReadOnly: boolean;        // Whether tool is read-only
    riskLevel: 'safe' | 'moderate' | 'destructive';
    input: Record<string, unknown>;  // Tool arguments
    timeout?: number;           // Optional timeout in seconds
  };
}
```

**New API Response Type:**
```typescript
interface ToolApprovalResponse {
  requestId: string;
  decision: 'allow_once' | 'allow_session' | 'deny';
  reason?: string;  // Optional reason for audit
}
```

#### 2.2 Backend Changes

**Approval State Manager (`packages/web/lib/server/approval-manager.ts`):**
```typescript
class ApprovalManager {
  private pendingApprovals = new Map<string, {
    resolve: (decision: ApprovalDecision) => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
    threadId: ThreadId;
    toolName: string;
  }>();

  async requestApproval(
    threadId: ThreadId,
    toolName: string,
    input: unknown,
    isReadOnly: boolean,
    timeoutMs: number = 30000
  ): Promise<ApprovalDecision> {
    const requestId = randomUUID();
    
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(requestId);
        reject(new Error('Approval request timed out'));
      }, timeoutMs);

      // Store pending approval
      this.pendingApprovals.set(requestId, {
        resolve,
        reject,
        timeout,
        threadId,
        toolName
      });

      // Emit SSE event
      const event: ToolApprovalRequest = {
        type: 'TOOL_APPROVAL_REQUEST',
        threadId,
        timestamp: new Date().toISOString(),
        data: {
          requestId,
          toolName,
          isReadOnly,
          riskLevel: this.getRiskLevel(toolName, isReadOnly),
          input,
          timeout: timeoutMs / 1000
        }
      };
      
      SSEManager.getInstance().broadcast(
        this.getSessionId(threadId),
        event
      );
    });
  }

  resolveApproval(requestId: string, decision: ApprovalDecision): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeout);
    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);
    return true;
  }

  private getRiskLevel(toolName: string, isReadOnly: boolean): 'safe' | 'moderate' | 'destructive' {
    if (isReadOnly) return 'safe';
    if (['file-write', 'file-edit', 'file-delete'].includes(toolName)) return 'moderate';
    if (['bash', 'delegate'].includes(toolName)) return 'destructive';
    return 'moderate';
  }
}
```

**New API Endpoint (`packages/web/app/api/approvals/[requestId]/route.ts`):**
```typescript
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
): Promise<NextResponse> {
  const { requestId } = await params;
  const body: ToolApprovalResponse = await request.json();
  
  const approvalManager = getApprovalManager();
  const success = approvalManager.resolveApproval(requestId, body.decision);
  
  if (!success) {
    return NextResponse.json(
      { error: 'Approval request not found or expired' },
      { status: 404 }
    );
  }
  
  return NextResponse.json({ status: 'resolved' });
}
```

#### 2.3 Frontend Components

**Approval Modal Component (`packages/web/components/ToolApprovalModal.tsx`):**
```typescript
interface ToolApprovalModalProps {
  request: ToolApprovalRequest['data'];
  onDecision: (decision: ApprovalDecision) => void;
  onTimeout: () => void;
}

export function ToolApprovalModal({ request, onDecision, onTimeout }: ToolApprovalModalProps) {
  const [timeLeft, setTimeLeft] = useState(request.timeout || 30);
  
  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          onTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [onTimeout]);

  const getRiskColor = () => {
    switch (request.riskLevel) {
      case 'safe': return 'text-green-400';
      case 'moderate': return 'text-yellow-400';
      case 'destructive': return 'text-red-400';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4">
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-bold">Tool Approval Required</h2>
          <span className="text-sm text-gray-400">{timeLeft}s</span>
        </div>
        
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg font-mono">{request.toolName}</span>
            <span className={`text-sm ${getRiskColor()}`}>
              {request.riskLevel}
            </span>
          </div>
          
          {request.toolDescription && (
            <p className="text-gray-400 text-sm mb-3">{request.toolDescription}</p>
          )}
          
          <div className="bg-gray-900 rounded p-3">
            <div className="text-xs text-gray-500 mb-1">Parameters:</div>
            <pre className="text-sm text-gray-300 overflow-x-auto">
              {JSON.stringify(request.input, null, 2)}
            </pre>
          </div>
        </div>
        
        <div className="flex gap-2">
          <button
            onClick={() => onDecision('allow_once')}
            className="flex-1 px-4 py-2 bg-green-600 rounded hover:bg-green-700"
          >
            Allow Once
          </button>
          <button
            onClick={() => onDecision('allow_session')}
            className="flex-1 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            Allow Session
          </button>
          <button
            onClick={() => onDecision('deny')}
            className="flex-1 px-4 py-2 bg-red-600 rounded hover:bg-red-700"
          >
            Deny
          </button>
        </div>
        
        <div className="mt-4 text-xs text-gray-500">
          <div>• Allow Once: Approve this specific call only</div>
          <div>• Allow Session: Approve all calls to {request.toolName} this session</div>
          <div>• Deny: Reject this tool call</div>
        </div>
      </div>
    </div>
  );
}
```

**Updated Main Page (`packages/web/app/page.tsx`):**
```typescript
// Add to state
const [approvalRequest, setApprovalRequest] = useState<ToolApprovalRequest['data'] | null>(null);

// Add to event listener setup
eventSource.addEventListener('TOOL_APPROVAL_REQUEST', (event: MessageEvent) => {
  const data = JSON.parse(event.data);
  setApprovalRequest(data.data);
});

// Handle approval decision
const handleApprovalDecision = async (decision: ApprovalDecision) => {
  if (!approvalRequest) return;
  
  try {
    await fetch(`/api/approvals/${approvalRequest.requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision })
    });
    
    setApprovalRequest(null);
  } catch (error) {
    console.error('Failed to submit approval decision:', error);
  }
};

// In render
{approvalRequest && (
  <ToolApprovalModal
    request={approvalRequest}
    onDecision={handleApprovalDecision}
    onTimeout={() => setApprovalRequest(null)}
  />
)}
```

### 3. Security Considerations

1. **Request ID Validation**: Use cryptographically secure random IDs
2. **Timeout Enforcement**: Auto-deny after timeout to prevent hanging
3. **Session Validation**: Ensure approval requests can only be resolved by the session owner
4. **Rate Limiting**: Prevent approval request spam
5. **Audit Trail**: Log all approval decisions with timestamps and reasons

### 4. User Experience

1. **Modal Design**: Clear, non-intrusive modal with risk indicators
2. **Keyboard Shortcuts**: 
   - `Y` or `A` = Allow Once
   - `S` = Allow Session  
   - `N` or `D` = Deny
   - `ESC` = Deny
3. **Risk Indicators**:
   - 🟢 Green = Read-only operations
   - 🟡 Yellow = File modifications
   - 🔴 Red = System commands or delegation
4. **Timeout Display**: Countdown timer showing remaining decision time
5. **Parameter Display**: Formatted view of what the tool will do

### 5. Implementation Phases

#### Phase 1: Basic Approval Flow
- Create approval manager and state tracking
- Implement SSE event for approval requests
- Build basic modal UI
- Create API endpoint for decisions

#### Phase 2: Enhanced UX
- Add keyboard shortcuts
- Implement risk level indicators
- Add parameter formatting for common tools
- Create approval history view

#### Phase 3: Advanced Features
- Session-wide approval policies
- Approval templates/presets
- Batch approvals for multiple tools
- Approval delegation to other users (future)

### 6. Testing Strategy

1. **Unit Tests**: Approval manager logic, timeout handling
2. **Integration Tests**: Full approval flow from agent to UI
3. **E2E Tests**: User interaction with modal
4. **Security Tests**: Request forgery, timeout enforcement

This design provides a secure, user-friendly tool approval system that maintains the safety guarantees of the CLI while enabling interactive web-based workflows.
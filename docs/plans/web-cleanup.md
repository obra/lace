# Web Interface Cleanup Plan

## Context: Understanding Lace Architecture

Lace is an AI coding assistant with an event-sourced architecture. Key concepts:

### Core Components
- **Agent**: The AI brain that processes conversations and executes tools
- **ThreadManager**: Manages conversation state as immutable event sequences
- **Tools**: File operations, bash commands, etc. that the Agent can execute
- **Interfaces**: UI layers that present the Agent to users (Terminal, NonInteractive, Web)

### Event-Sourcing Pattern
All conversations are stored as immutable event sequences:
```
USER_MESSAGE → AGENT_MESSAGE → TOOL_CALL → TOOL_RESULT → ...
```

Events can be replayed to reconstruct conversation state. This enables:
- Resumable conversations across restarts
- Multiple interface types working with same data
- Complete audit trail

### Current Interface Pattern
Look at `src/interfaces/terminal/terminal-interface.tsx` - it:
1. Creates an Agent instance
2. Listens to Agent events (`agent_thinking_start`, `tool_call_complete`, etc.)
3. Renders UI based on those events
4. Sends user input to Agent via `agent.sendMessage()`

## Problem Statement

The current web interface implementation is architecturally flawed:
1. **Subprocess Anti-Pattern**: Web API spawns CLI as subprocess instead of using Agent directly
2. **Mixed Concerns**: Next.js files pollute backend directory structure
3. **Missing Event Integration**: Doesn't leverage Lace's event-sourcing system
4. **No Tool Approval**: Can't handle interactive tool approvals

## Solution Overview

Restructure to:
1. Move Next.js app into `src/interfaces/web/` alongside WebInterface
2. Create proper WebInterface that integrates with Agent system
3. Add web interface option to CLI entry point
4. Use event-sourcing for real-time updates
5. Support full Agent capabilities (tool approval, streaming, resumption)

## Tasks

### Task 1: Setup Test Infrastructure
**Goal**: Ensure we can test the refactoring

**Files to check first**:
- `vitest.config.ts` - Test configuration
- `src/__tests__/setup.ts` - Test setup utilities
- `src/interfaces/terminal/__tests__/terminal-interface-*.test.tsx` - Terminal interface tests

**What to do**:
1. Create `src/interfaces/web/__tests__/web-interface.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebInterface } from '../web-interface.js';
import { Agent } from '~/agents/agent.js';

describe('WebInterface', () => {
  let mockAgent: Agent;
  let webInterface: WebInterface;

  beforeEach(() => {
    // TODO: Setup mock agent
    mockAgent = {} as Agent;
    webInterface = new WebInterface(mockAgent);
  });

  it('should be defined', () => {
    expect(webInterface).toBeDefined();
  });

  it('should implement UserInterface', () => {
    expect(webInterface.displayMessage).toBeDefined();
    expect(webInterface.clearSession).toBeDefined();
    expect(webInterface.exit).toBeDefined();
  });
});
```

2. Create `src/apps/web/__tests__/api.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('Web API', () => {
  it('should handle POST requests', async () => {
    // TODO: Test API endpoints
    expect(true).toBe(true);
  });
});
```

**Test it**: `npm test -- web-interface.test.ts`

**Commit**: "test: add web interface test scaffolding"

### Task 2: Create Directory Structure
**Goal**: Move web interface into proper interface directory alongside WebInterface

**Files to move**:
- `src/app/` → `src/interfaces/web/app/`
- `src/components/` → `src/interfaces/web/components/`
- `src/hooks/` → `src/interfaces/web/hooks/`
- `src/types/chat.ts` → `src/interfaces/web/types/chat.ts`

**What to do**:
1. Create directories:
```bash
mkdir -p src/interfaces/web/app
mkdir -p src/interfaces/web/components
mkdir -p src/interfaces/web/hooks
mkdir -p src/interfaces/web/types
```

2. Move files:
```bash
mv src/app/* src/interfaces/web/app/
mv src/components/* src/interfaces/web/components/
mv src/hooks/* src/interfaces/web/hooks/
mv src/types/chat.ts src/interfaces/web/types/
```

3. Update imports in moved files. Change:
```typescript
// OLD
import { useChat } from '~/hooks';
// NEW  
import { useChat } from '../hooks';
```

4. Update `next.config.ts` to point to new location:
```typescript
/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    appDir: true,
  },
  // Point to web interface directory
  distDir: './src/interfaces/web/.next',
};
```

5. Update `package.json` scripts:
```json
{
  "scripts": {
    "start:web": "npm run build && NEXT_CONFIG_PATH=./src/interfaces/web/next.config.ts next dev",
    "build:web": "npm run build && NEXT_CONFIG_PATH=./src/interfaces/web/next.config.ts next build"
  }
}
```

6. Move Next.js config files to web interface:
```bash
mv next.config.ts src/interfaces/web/
mv next-env.d.ts src/interfaces/web/
mv tailwind.config.js src/interfaces/web/
mv postcss.config.js src/interfaces/web/
```

**Test it**: 
- `npm run start:web` should work
- `npm run build:web` should work
- Web interface should function identically

**Commit**: "refactor: move Next.js app to src/interfaces/web/"

### Task 3: Create WebInterface Class
**Goal**: Implement proper interface that integrates with Agent system

**Files to study first**:
- `src/interfaces/terminal/terminal-interface.tsx` (lines 1-100) - Interface pattern
- `src/interfaces/non-interactive-interface.ts` - Simpler interface example
- `src/commands/types.ts` - UserInterface contract
- `src/agents/agent.ts` - Agent events and methods

**What to do**:
1. Create `src/interfaces/web/web-interface.ts`:
```typescript
// ABOUTME: Web interface for browser-based Lace interactions
// ABOUTME: Integrates with Agent system via events and direct method calls

import { EventEmitter } from 'events';
import type { Agent } from '~/agents/agent.js';
import type { UserInterface } from '~/commands/types.js';
import type { ThreadEvent } from '~/threads/types.js';

export interface WebInterfaceEvents {
  message: { content: string; role: 'user' | 'assistant' };
  thinking_start: void;
  thinking_complete: void;
  tool_call_start: { toolName: string; args: unknown };
  tool_call_complete: { toolName: string; result: unknown };
  tool_approval_required: { toolName: string; args: unknown; callback: (approved: boolean) => void };
  error: { message: string };
}

export class WebInterface extends EventEmitter implements UserInterface {
  agent: Agent;
  private isStarted = false;

  constructor(agent: Agent) {
    super();
    this.agent = agent;
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen to Agent events and re-emit for web clients
    this.agent.on('agent_thinking_start', () => {
      this.emit('thinking_start');
    });

    this.agent.on('agent_thinking_complete', () => {
      this.emit('thinking_complete');
    });

    this.agent.on('tool_call_start', (data) => {
      this.emit('tool_call_start', data);
    });

    this.agent.on('tool_call_complete', (data) => {
      this.emit('tool_call_complete', data);
    });

    // TODO: Add other event handlers based on terminal interface
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    
    await this.agent.start();
    this.isStarted = true;
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.isStarted) {
      throw new Error('WebInterface not started');
    }
    
    this.emit('message', { content: message, role: 'user' });
    await this.agent.sendMessage(message);
  }

  // UserInterface implementation
  displayMessage(message: string): void {
    this.emit('message', { content: message, role: 'assistant' });
  }

  clearSession(): void {
    const newThreadId = this.agent.generateThreadId();
    this.agent.createThread(newThreadId);
  }

  exit(): void {
    this.agent.abort();
    this.emit('exit');
  }
}
```

2. Update test from Task 1:
```typescript
// Update src/interfaces/web/__tests__/web-interface.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebInterface } from '../web-interface.js';
import { Agent } from '~/agents/agent.js';

describe('WebInterface', () => {
  let mockAgent: Agent;
  let webInterface: WebInterface;

  beforeEach(() => {
    mockAgent = {
      on: vi.fn(),
      start: vi.fn(),
      sendMessage: vi.fn(),
      generateThreadId: vi.fn().mockReturnValue('test-thread'),
      createThread: vi.fn(),
      abort: vi.fn(),
    } as unknown as Agent;
    
    webInterface = new WebInterface(mockAgent);
  });

  it('should setup agent event listeners', () => {
    expect(mockAgent.on).toHaveBeenCalledWith('agent_thinking_start', expect.any(Function));
    expect(mockAgent.on).toHaveBeenCalledWith('agent_thinking_complete', expect.any(Function));
  });

  it('should start agent when started', async () => {
    await webInterface.start();
    expect(mockAgent.start).toHaveBeenCalled();
  });

  it('should send message to agent', async () => {
    await webInterface.start();
    await webInterface.sendMessage('test message');
    expect(mockAgent.sendMessage).toHaveBeenCalledWith('test message');
  });

  it('should emit user message event', async () => {
    await webInterface.start();
    
    const messageHandler = vi.fn();
    webInterface.on('message', messageHandler);
    
    await webInterface.sendMessage('test message');
    
    expect(messageHandler).toHaveBeenCalledWith({
      content: 'test message',
      role: 'user'
    });
  });
});
```

**Test it**: `npm test -- web-interface.test.ts`

**Commit**: "feat: add WebInterface class with Agent integration"

### Task 4: Create Web API with WebInterface
**Goal**: Replace subprocess approach with direct Agent integration

**Files to study first**:
- `src/apps/web/app/api/lace/route.ts` - Current API implementation
- `src/cli.ts` - How CLI creates Agent instances
- `src/interfaces/terminal/terminal-interface.tsx` - Agent creation pattern

**What to do**:
1. Create `src/interfaces/web/lib/agent-factory.ts`:
```typescript
// ABOUTME: Factory for creating Agent instances in web context
// ABOUTME: Handles provider selection and configuration

import { Agent } from '~/agents/agent.js';
import { ThreadManager } from '~/threads/thread-manager.js';
import { ToolExecutor } from '~/tools/executor.js';
import { getProviderRegistry } from '~/providers/registry.js';

export function createWebAgent(options: {
  provider?: string;
  threadId?: string;
}): Agent {
  const providerRegistry = getProviderRegistry();
  const provider = providerRegistry.get(options.provider || 'anthropic');
  
  if (!provider) {
    throw new Error(`Provider ${options.provider} not found`);
  }

  const threadManager = new ThreadManager();
  const toolExecutor = new ToolExecutor();

  const agent = new Agent({
    provider,
    threadManager,
    toolExecutor,
    threadId: options.threadId,
  });

  return agent;
}
```

2. Update `src/interfaces/web/app/api/lace/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { WebInterface } from '~/interfaces/web/web-interface.js';
import { createWebAgent } from '../../lib/agent-factory.js';

interface RequestBody {
  message: string;
  threadId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    
    // Create Agent and WebInterface
    const agent = createWebAgent({ 
      provider: 'anthropic',
      threadId: body.threadId 
    });
    
    const webInterface = new WebInterface(agent);
    await webInterface.start();

    // Stream the response using Server-Sent Events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Handle WebInterface events
        webInterface.on('message', (data) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'message', ...data })}\n\n`)
          );
        });

        webInterface.on('thinking_start', () => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'thinking_start' })}\n\n`)
          );
        });

        webInterface.on('thinking_complete', () => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'thinking_complete' })}\n\n`)
          );
        });

        webInterface.on('tool_call_start', (data) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'tool_call_start', ...data })}\n\n`)
          );
        });

        webInterface.on('tool_call_complete', (data) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'tool_call_complete', ...data })}\n\n`)
          );
        });

        webInterface.on('error', (data) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', ...data })}\n\n`)
          );
        });

        // Send the message and handle completion
        webInterface.sendMessage(body.message).then(() => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`)
          );
          controller.close();
        }).catch((error) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`)
          );
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process request',
      },
      { status: 500 }
    );
  }
}
```

3. Update test from Task 1:
```typescript
// Update src/interfaces/web/__tests__/api.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../app/api/lace/route.js';
import { createWebAgent } from '../lib/agent-factory.js';

vi.mock('../lib/agent-factory.js');

describe('Web API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create agent with correct parameters', async () => {
    const mockCreateWebAgent = vi.mocked(createWebAgent);
    mockCreateWebAgent.mockReturnValue({
      start: vi.fn(),
      sendMessage: vi.fn(),
    } as any);

    const request = new Request('http://localhost/api/lace', {
      method: 'POST',
      body: JSON.stringify({ message: 'test message' }),
    });

    await POST(request as any);

    expect(mockCreateWebAgent).toHaveBeenCalledWith({
      provider: 'anthropic',
      threadId: undefined,
    });
  });
});
```

**Test it**: 
- `npm test -- api.test.ts`
- `npm run start:web` and test manually in browser

**Commit**: "feat: replace subprocess API with direct Agent integration"

### Task 5: Update Frontend to Handle New Event Types
**Goal**: Support thinking indicators, tool calls, and proper streaming

**Files to study first**:
- `src/interfaces/web/hooks/useChat.ts` - Current chat logic
- `src/interfaces/web/hooks/useSSEStream.ts` - SSE handling
- `src/interfaces/terminal/components/events/` - How terminal handles events

**What to do**:
1. Update `src/interfaces/web/types/chat.ts`:
```typescript
export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  thinking?: boolean;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  status: 'pending' | 'complete' | 'error';
}

export interface ChatState {
  messages: Message[];
  isThinking: boolean;
  currentToolCall?: ToolCall;
}
```

2. Update `src/interfaces/web/hooks/useChat.ts`:
```typescript
import { useState, useCallback, useReducer } from 'react';
import type { Message, ChatState, ToolCall } from '../types/chat.js';

interface ChatAction {
  type: 'add_message' | 'update_message' | 'set_thinking' | 'add_tool_call' | 'update_tool_call';
  payload: any;
}

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'add_message':
      return {
        ...state,
        messages: [...state.messages, action.payload],
      };
    
    case 'update_message':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.payload.id ? { ...msg, ...action.payload.updates } : msg
        ),
      };
    
    case 'set_thinking':
      return {
        ...state,
        isThinking: action.payload,
      };
    
    case 'add_tool_call':
      return {
        ...state,
        currentToolCall: action.payload,
      };
    
    case 'update_tool_call':
      return {
        ...state,
        currentToolCall: state.currentToolCall 
          ? { ...state.currentToolCall, ...action.payload }
          : undefined,
      };
    
    default:
      return state;
  }
}

const INITIAL_STATE: ChatState = {
  messages: [{
    id: '1',
    role: 'assistant',
    content: "Hello! I'm Lace, your AI coding assistant. How can I help you today?",
    timestamp: new Date(),
  }],
  isThinking: false,
};

export function useChat() {
  const [state, dispatch] = useReducer(chatReducer, INITIAL_STATE);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    dispatch({ type: 'add_message', payload: userMessage });
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/lace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage.content }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantMessage: Message | null = null;

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            switch (data.type) {
              case 'message':
                if (data.role === 'assistant') {
                  if (!assistantMessage) {
                    assistantMessage = {
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: data.content,
                      timestamp: new Date(),
                    };
                    dispatch({ type: 'add_message', payload: assistantMessage });
                  } else {
                    dispatch({ 
                      type: 'update_message', 
                      payload: { 
                        id: assistantMessage.id, 
                        updates: { content: data.content } 
                      } 
                    });
                  }
                }
                break;
              
              case 'thinking_start':
                dispatch({ type: 'set_thinking', payload: true });
                break;
              
              case 'thinking_complete':
                dispatch({ type: 'set_thinking', payload: false });
                break;
              
              case 'tool_call_start':
                dispatch({ 
                  type: 'add_tool_call', 
                  payload: { 
                    id: Date.now().toString(),
                    name: data.toolName,
                    args: data.args,
                    status: 'pending'
                  } 
                });
                break;
              
              case 'tool_call_complete':
                dispatch({ 
                  type: 'update_tool_call', 
                  payload: { 
                    result: data.result,
                    status: 'complete'
                  } 
                });
                break;
              
              case 'complete':
                setIsLoading(false);
                break;
              
              case 'error':
                console.error('API Error:', data.message);
                setIsLoading(false);
                break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error:', error);
      setIsLoading(false);
    }
  }, [input, isLoading]);

  return {
    ...state,
    input,
    setInput,
    isLoading,
    sendMessage,
  };
}
```

3. Update `src/interfaces/web/components/chat/MessageList.tsx`:
```typescript
import type { Message, ChatState } from '../../types/chat.js';
import { ChatMessage } from './ChatMessage.js';
import { LoadingDots } from '../ui/LoadingDots.js';

interface MessageListProps {
  messages: Message[];
  isThinking: boolean;
  isLoading: boolean;
  currentToolCall?: ChatState['currentToolCall'];
}

export function MessageList({ messages, isThinking, isLoading, currentToolCall }: MessageListProps) {
  return (
    <div className="flex-1 overflow-y-auto space-y-4 mb-4">
      {messages.map((message) => (
        <ChatMessage key={message.id} message={message} />
      ))}
      
      {isThinking && (
        <div className="flex items-center gap-2 text-blue-600">
          <LoadingDots />
          <span>Thinking...</span>
        </div>
      )}
      
      {currentToolCall && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3">
          <div className="font-medium text-yellow-800">
            Running tool: {currentToolCall.name}
          </div>
          {currentToolCall.status === 'pending' && (
            <div className="text-yellow-600 text-sm">
              <LoadingDots />
              Executing...
            </div>
          )}
          {currentToolCall.status === 'complete' && (
            <div className="text-green-600 text-sm">✓ Complete</div>
          )}
        </div>
      )}
    </div>
  );
}
```

4. Update `src/interfaces/web/components/ChatInterface.tsx`:
```typescript
'use client';

import { ChatHeader, ChatInput, MessageList } from './chat';
import { useChat } from '../hooks/useChat.js';

export default function ChatInterface() {
  const { messages, input, setInput, isLoading, isThinking, currentToolCall, sendMessage } = useChat();

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <ChatHeader />
      <div className="flex-1 container mx-auto max-w-4xl p-4 flex flex-col">
        <MessageList 
          messages={messages} 
          isThinking={isThinking}
          isLoading={isLoading}
          currentToolCall={currentToolCall}
        />
        <ChatInput
          value={input}
          onChange={setInput}
          onSubmit={sendMessage}
          disabled={isLoading}
        />
      </div>
    </div>
  );
}
```

**Test it**: 
- `lace --web` (after implementing server)
- `npm run start:web` (for development)
- Send message and verify thinking indicator appears
- Send message that triggers tool (e.g., "list files in current directory")
- Verify tool execution is shown

**Commit**: "feat: add thinking indicators and tool call visualization"

### Task 6: Add Tool Approval Support
**Goal**: Support interactive tool approval in web interface

**Files to study first**:
- `src/tools/approval-types.ts` - Approval system
- `src/interfaces/terminal/components/tool-approval-modal.tsx` - Terminal approval UI
- `src/agents/agent.ts` - How agent handles approval callbacks

**What to do**:
1. Update `src/interfaces/web/web-interface.ts` to handle approval:
```typescript
// Add to WebInterface class:
private pendingApprovals = new Map<string, (approved: boolean) => void>();

private setupEventListeners(): void {
  // ... existing listeners ...
  
  // Handle tool approval requests
  this.agent.toolExecutor.setApprovalCallback(async (toolName, args) => {
    return new Promise<boolean>((resolve) => {
      const approvalId = Date.now().toString();
      this.pendingApprovals.set(approvalId, resolve);
      
      this.emit('tool_approval_required', {
        approvalId,
        toolName,
        args,
      });
    });
  });
}

public approveToolCall(approvalId: string, approved: boolean): void {
  const callback = this.pendingApprovals.get(approvalId);
  if (callback) {
    callback(approved);
    this.pendingApprovals.delete(approvalId);
  }
}
```

2. Update web API to handle approval:
```typescript
// Add to src/interfaces/web/app/api/lace/route.ts
webInterface.on('tool_approval_required', (data) => {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ type: 'tool_approval_required', ...data })}\n\n`)
  );
});
```

3. Create approval API endpoint `src/interfaces/web/app/api/lace/approve/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';

// Store active WebInterface instances (in production, use Redis or similar)
const activeInterfaces = new Map<string, any>();

export async function POST(request: NextRequest) {
  try {
    const { approvalId, approved, sessionId } = await request.json();
    
    const webInterface = activeInterfaces.get(sessionId);
    if (!webInterface) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    
    webInterface.approveToolCall(approvalId, approved);
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process approval' },
      { status: 500 }
    );
  }
}
```

4. Add approval UI component `src/interfaces/web/components/ToolApprovalModal.tsx`:
```typescript
import { useState } from 'react';

interface ToolApprovalModalProps {
  approvalId: string;
  toolName: string;
  args: unknown;
  onApprove: (approvalId: string, approved: boolean) => void;
}

export function ToolApprovalModal({ 
  approvalId, 
  toolName, 
  args, 
  onApprove 
}: ToolApprovalModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = async (approved: boolean) => {
    setIsProcessing(true);
    await onApprove(approvalId, approved);
    setIsProcessing(false);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">Tool Approval Required</h3>
        
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            The AI wants to run the following tool:
          </p>
          <div className="mt-2 p-3 bg-gray-100 rounded">
            <div className="font-medium">{toolName}</div>
            <pre className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => handleApprove(false)}
            disabled={isProcessing}
            className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
          >
            Deny
          </button>
          <button
            onClick={() => handleApprove(true)}
            disabled={isProcessing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isProcessing ? 'Processing...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

5. Update `useChat` to handle approvals:
```typescript
// Add to useChat hook:
const [pendingApproval, setPendingApproval] = useState<{
  approvalId: string;
  toolName: string;
  args: unknown;
} | null>(null);

const handleApproval = useCallback(async (approvalId: string, approved: boolean) => {
  await fetch('/api/lace/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approvalId, approved, sessionId: 'current' }),
  });
  setPendingApproval(null);
}, []);

// Add to event handling:
case 'tool_approval_required':
  setPendingApproval({
    approvalId: data.approvalId,
    toolName: data.toolName,
    args: data.args,
  });
  break;
```

**Test it**: 
- `lace --web` (after implementing server)
- `npm run start:web` (for development)  
- Send message that requires tool approval: "write hello world to test.txt"
- Verify approval modal appears
- Test approving and denying

**Commit**: "feat: add tool approval support to web interface"

### Task 7: Add Thread Resumption Support
**Goal**: Support resuming conversations like CLI `--continue`

**Files to study first**:
- `src/cli.ts` - How CLI handles `--continue`
- `src/threads/thread-manager.ts` - Thread management
- `src/interfaces/terminal/terminal-interface.tsx` - Thread resumption

**What to do**:
1. Add thread management to web API:
```typescript
// Update src/interfaces/web/app/api/lace/route.ts
interface RequestBody {
  message: string;
  threadId?: string;
  resumeLatest?: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    
    let threadId = body.threadId;
    
    // Handle resume latest
    if (body.resumeLatest && !threadId) {
      const threadManager = new ThreadManager();
      const threads = await threadManager.listThreads();
      threadId = threads[0]?.id; // Most recent thread
    }
    
    const agent = createWebAgent({ 
      provider: 'anthropic',
      threadId 
    });
    
    // ... rest of implementation
  }
}
```

2. Add thread management UI `src/interfaces/web/components/ThreadManager.tsx`:
```typescript
import { useState, useEffect } from 'react';

interface Thread {
  id: string;
  title: string;
  lastMessage: string;
  timestamp: Date;
}

interface ThreadManagerProps {
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
}

export function ThreadManager({ onSelectThread, onNewThread }: ThreadManagerProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Load threads from API
    fetch('/api/threads')
      .then(res => res.json())
      .then(setThreads)
      .catch(console.error);
  }, []);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded hover:bg-gray-200"
      >
        <span>💬</span>
        <span>Conversations</span>
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-80 bg-white border border-gray-300 rounded shadow-lg z-10">
          <div className="p-3 border-b">
            <button
              onClick={() => {
                onNewThread();
                setIsOpen(false);
              }}
              className="w-full px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              New Conversation
            </button>
          </div>
          
          <div className="max-h-64 overflow-y-auto">
            {threads.map(thread => (
              <button
                key={thread.id}
                onClick={() => {
                  onSelectThread(thread.id);
                  setIsOpen(false);
                }}
                className="w-full p-3 text-left hover:bg-gray-50 border-b border-gray-100"
              >
                <div className="font-medium truncate">{thread.title}</div>
                <div className="text-sm text-gray-600 truncate">{thread.lastMessage}</div>
                <div className="text-xs text-gray-400">{thread.timestamp.toLocaleString()}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

3. Create threads API `src/interfaces/web/app/api/threads/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { ThreadManager } from '~/threads/thread-manager.js';

export async function GET() {
  try {
    const threadManager = new ThreadManager();
    const threads = await threadManager.listThreads();
    
    return NextResponse.json(threads);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load threads' },
      { status: 500 }
    );
  }
}
```

4. Update `ChatInterface` to include thread management:
```typescript
// Update src/interfaces/web/components/ChatInterface.tsx
import { ThreadManager } from './ThreadManager.js';

export default function ChatInterface() {
  const { messages, input, setInput, isLoading, sendMessage, loadThread, newThread } = useChat();

  return (
    <div className="min-h-screen bg-base-200 flex flex-col">
      <ChatHeader>
        <ThreadManager 
          onSelectThread={loadThread}
          onNewThread={newThread}
        />
      </ChatHeader>
      {/* ... rest of component */}
    </div>
  );
}
```

**Test it**: 
- `lace --web` (after implementing server)
- `npm run start:web` (for development)
- Start conversation, refresh page
- Verify you can resume conversation
- Test creating new conversations

**Commit**: "feat: add thread resumption and conversation management"

### Task 8: Final Testing and Documentation
**Goal**: Ensure everything works and document the new architecture

**What to do**:
1. Run full test suite:
```bash
npm run test:run
npm run typecheck
npm run lint
```

2. Test manual scenarios:
   - Start web interface with `lace --web`
   - Send messages that trigger tools
   - Approve/deny tools
   - Resume conversations
   - Create new conversations

3. Add CLI flag for web interface. Update `src/cli.ts`:
```typescript
// Add --web flag handling
if (options.web) {
  // Start web server instead of terminal interface
  const webServer = await import('./interfaces/web/server.js');
  await webServer.start();
  return;
}
```

4. Create web server `src/interfaces/web/server.ts`:
```typescript
// ABOUTME: Web server that starts Next.js app for web interface
// ABOUTME: Integrates with CLI entry point via --web flag

import { exec } from 'child_process';
import path from 'path';

export async function start(): Promise<void> {
  const webDir = path.join(__dirname);
  
  console.log('🌐 Starting Lace web interface...');
  console.log('📍 Open http://localhost:3000 in your browser');
  
  const nextProcess = exec('next dev', { cwd: webDir });
  
  nextProcess.stdout?.on('data', (data) => {
    console.log(data.toString());
  });
  
  nextProcess.stderr?.on('data', (data) => {
    console.error(data.toString());
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    nextProcess.kill();
    process.exit(0);
  });
}
```

5. Update `README.md` with web interface section:
```markdown
## Web Interface

Lace includes a web interface built with Next.js that provides the full Agent experience in the browser.

### Starting the Web Interface

```bash
lace --web
# or for development
npm run start:web
```

### Features

- Real-time streaming responses
- Tool approval workflow
- Conversation resumption
- Thinking indicators
- Full Agent integration

### Architecture

The web interface uses the same Agent system as the CLI:

- `WebInterface` class integrates directly with Agent
- Events are streamed via Server-Sent Events
- Tool approvals handled through modal dialogs
- Thread management for conversation persistence
```

6. Create migration guide `docs/web-interface-migration.md`:
```markdown
# Web Interface Migration Guide

This document explains the changes made to integrate the web interface properly.

## What Changed

1. **Directory Structure**: Next.js app moved to `src/apps/web/`
2. **Agent Integration**: Web API now uses Agent directly instead of subprocess
3. **Event Streaming**: Real-time updates via WebInterface events
4. **Tool Approval**: Interactive tool approval support

## Breaking Changes

- Web API endpoints changed structure
- SSE event format updated
- Tool approval now supported

## Migration Steps

If you were using the old web interface:

1. Update API calls to handle new event types
2. Add tool approval handling
3. Update imports if you were importing from old locations
```

**Test it**: Full manual testing of all features

**Commit**: "docs: add web interface documentation and migration guide"

## Summary

This plan transforms the web interface from a subprocess-based hack into a proper first-class interface that leverages Lace's event-sourcing architecture. The key insights:

1. **Proper Integration**: WebInterface extends the same pattern as TerminalInterface
2. **Event-Driven**: Real-time updates via Agent events, not polling
3. **Full Feature Parity**: Tool approval, thread management, streaming
4. **Clean Architecture**: Separation of concerns between web app and backend

The result is a web interface that feels like a native part of Lace, not a bolted-on afterthought.
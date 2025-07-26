# Agent Process Architecture Plan

## Decision: One Process Per Session

After analyzing the requirements, **one process per session** is the optimal architecture.

## Why Per-Session?

### Key Requirements
1. **Tools need project-specific CWD**: Each project has its own working directory
2. **Tools need project environment**: Environment variables are project-scoped  
3. **Agents share task queue**: Multiple agents in a session coordinate via tasks
4. **Typical load**: ~12 concurrent sessions
5. **Failure isolation**: One session shouldn't crash others

### Process Model Comparison

| Model | Pros | Cons | Verdict |
|-------|------|------|---------|
| **One process for all** | Simple event loop | One crash kills everything | ❌ Too risky |
| **Per project** | Project isolation | Multiple sessions per project collide | ❌ Wrong boundary |
| **Per session** ✅ | Natural work boundary, shared project context | ~12 processes | ✅ **Best fit** |
| **Per agent** | Maximum isolation | Too many processes, no task sharing | ❌ Over-engineered |

## Architecture Design

```
┌─────────────────┐
│   Next.js UI    │
│   (Main Process)│
└────────┬────────┘
         │ IPC/HTTP
    ┌────┴────┐
    │ Session │
    │ Manager │
    └────┬────┘
         │ spawn()
    ┌────┴────────────────────────────┐
    │                                  │
┌───▼─────────┐  ┌────▼──────┐  ┌────▼──────┐
│  Session 1  │  │ Session 2  │  │ Session N  │
│  Process    │  │  Process   │  │  Process   │
├─────────────┤  ├────────────┤  ├────────────┤
│ CWD: proj-a │  │ CWD: proj-b│  │ CWD: proj-c│
│ ENV: proj-a │  │ ENV: proj-b│  │ ENV: proj-c│
├─────────────┤  ├────────────┤  ├────────────┤
│ - Agent 1   │  │ - Agent 1  │  │ - Agent 1  │
│ - Agent 2   │  │ - Agent 2  │  │ - Agent 2  │
│ - Task Mgr  │  │ - Task Mgr │  │ - Task Mgr │
└─────────────┘  └────────────┘  └────────────┘
```

## Implementation Plan

### Phase 1: Session Process Infrastructure

1. **Create SessionProcess class**
   ```typescript
   class SessionProcess {
     private process: ChildProcess;
     private agents: Map<ThreadId, Agent>;
     private taskManager: TaskManager;
     
     constructor(
       sessionId: ThreadId,
       projectPath: string,
       projectEnv: Record<string, string>
     ) {
       // Fork process with project-specific CWD and env
       this.process = fork('./session-worker.ts', [], {
         cwd: projectPath,
         env: { ...process.env, ...projectEnv }
       });
     }
   }
   ```

2. **Session Worker Script**
   - Runs in project directory
   - Manages all agents for the session
   - Handles IPC messages from main process

3. **IPC Protocol**
   ```typescript
   type SessionMessage = 
     | { type: 'spawn-agent', name: string, model: string }
     | { type: 'send-message', agentId: string, content: string }
     | { type: 'get-status' }
     | { type: 'shutdown' };
   ```

### Phase 2: Event Propagation

1. **Event Bridge**
   - Session process emits events via IPC
   - Main process forwards to SSE clients
   - No EventEmitter across process boundary

2. **Message Flow**
   ```
   Agent.emit('token') 
     → SessionProcess captures
     → IPC to main process  
     → SSEManager.broadcast()
     → Client receives
   ```

### Phase 3: State Management

1. **Main Process (UI)**
   - Manages session lifecycle
   - Routes requests to session processes
   - Handles SSE connections

2. **Session Process**
   - Owns all agents for session
   - Manages task queue
   - Executes tools with proper CWD/env

3. **Shared State**
   - SQLite remains shared (file-based)
   - Each process can read/write events
   - SQLite's WAL mode handles concurrent access well
   - Built-in ACID guarantees for event ordering

## Benefits

1. **Proper Isolation**
   - Project environments don't conflict
   - Session crashes don't affect others
   - Clean process boundaries

2. **Resource Efficiency**  
   - ~12 processes is manageable
   - Shared resources within session
   - No over-fragmentation

3. **Tool Execution**
   - Correct CWD per project
   - Proper env vars loaded
   - No context switching needed

4. **Future Flexibility**
   - Could add resource limits per session
   - Easy to monitor/restart individual sessions
   - Clean path to distributed architecture

## Migration Path

1. **Keep single-process mode working** (current state)
2. **Add session process option** behind flag
3. **Test with single session** 
4. **Enable for all sessions**
5. **Remove single-process code** (eventually)

## Open Questions

1. **IPC vs HTTP?** - IPC is faster but HTTP is more flexible
2. **Process pooling?** - Reuse processes for new sessions?
3. **Graceful shutdown?** - How to handle ongoing LLM calls?

## Next Steps

1. Implement basic SessionProcess class
2. Create session-worker.ts entry point  
3. Add IPC message handling
4. Test with single session
5. Add event forwarding
6. Full integration testing
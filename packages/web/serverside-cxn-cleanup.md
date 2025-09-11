# Server-Side Connection Cleanup Investigation

## Problem Statement
Server connections accumulate without proper cleanup during browser navigation, tab closure, and page refresh. Connections should be cleaned up when clients disconnect, but many persist indefinitely.

## Evidence from Investigation

### Connection Accumulation Pattern
```
[EVENT_STREAM] New connection established ...totalConnections":1
[EVENT_STREAM] New connection established ...totalConnections":2  
[EVENT_STREAM] New connection established ...totalConnections":3
[EVENT_STREAM] New connection established ...totalConnections":4
(continues growing...)
```

### Inconsistent Cleanup Behavior
**Good cleanup (working):**
- Connection duration 32ms - removed quickly
- Connection duration 27ms - removed quickly
- Some connections trigger proper disconnect events

**Bad cleanup (broken):**
- Connections from 20:14:59 still active at 20:22:46 (8+ minutes old)
- Many connections accumulate without removal
- Client disconnects not detected

### Server-Side Code Analysis

**Current cleanup mechanisms:**
1. `request.signal?.addEventListener('abort')` in `api.events.stream.ts:22`
2. `cancel()` method in ReadableStream 
3. Keepalive mechanism every 30 seconds in EventStreamManager
4. `controller.desiredSize === null` checks for dead connections

**Improvements already implemented:**
1. **Better keepalive detection** - more aggressive dead connection detection
2. **Improved error handling** - better logging of connection failures  
3. **Enhanced connection state checking** - force writes to detect failures

## Root Cause Hypothesis

**Browser disconnect events are unreliable**:
- Tab close, navigation, refresh don't always trigger `request.signal` abort
- EventSource connections may appear "alive" to server even when client is gone
- HTTP/1.1 connection behavior differs from WebSocket explicit close frames

**The real issue**: Server can't reliably detect when EventSource clients disconnect, leading to "zombie" connections that consume resources.

## Investigation Needed

1. **Test abort signal reliability**: Does `request.signal` consistently fire during:
   - Page refresh
   - Tab close  
   - Browser navigation
   - Browser close

2. **Connection state verification**: Are connections that appear "alive" actually receiving/processing events?

3. **Keepalive effectiveness**: Is the 30-second keepalive aggressive enough to catch dead connections?

4. **Network layer behavior**: How does browser EventSource handle connection drops vs server detection?

## Potential Solutions

### Option A: More Aggressive Keepalive
- Reduce keepalive interval (30s → 5s in development)
- Implement heartbeat/ping mechanism
- Force connection writes more frequently

### Option B: Connection Timeout
- Add maximum connection age (e.g., 10 minutes)
- Force disconnect old connections regardless of apparent "alive" state
- Implement per-connection activity tracking

### Option C: Better Dead Connection Detection
- Implement multiple detection methods (not just desiredSize)
- Add connection health scoring
- Track actual event delivery success/failure

### Option D: Client-Side Connection Management
- Add client-side keepalive pings
- Implement explicit disconnect on navigation
- Use beforeunload events for cleanup

## Current Status
- ✅ Client-side multiple connections fixed with Zustand store
- ❌ Server-side connection accumulation still occurring
- ✅ Some server cleanup is working (quick removals)
- ❌ Inconsistent cleanup leaves zombie connections

## Next Steps
1. Test server abort signal reliability during different disconnect scenarios
2. Implement more aggressive dead connection detection
3. Add connection timeout/max age limits
4. Consider client-side explicit disconnect on navigation
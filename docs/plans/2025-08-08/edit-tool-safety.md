# File Edit Tool Safety: Read-Before-Write Protection

## Problem Statement

Currently, file modification tools (file-write, file-insert, file-edit) can accidentally overwrite or modify existing files without the agent having read them first. This poses a risk of unintended data loss, especially with less capable models that might not remember to read files before modifying them.

This mirrors a safety feature in Claude Code where the Write tool enforces that files must be read before they can be overwritten.

## Solution Overview

Implement a read-before-write protection system that:
1. Tracks which files have been read in the current conversation (since last compaction)
2. Prevents write/insert/edit operations on existing files that haven't been read
3. Provides clear error messages guiding agents to read files first
4. Works correctly across agent recreations in the web context

## Design Decisions

### Where to Track Read Files

**Option Chosen: Query Thread History**
- The thread's event history is the source of truth
- Query it to find successful `file_read` tool calls
- No state to maintain, works across agent recreations
- Automatically cleared on compaction (desired behavior)

**Rejected Alternatives:**
- Agent instance state: Lost on recreation in web context
- Session level: Too persistent, wrong scope (multiple agents per session)
- Static/global: Would be shared across all agents (incorrect)
- ThreadManager state: Would persist in database (too persistent)

### API Design

**Option Chosen: Agent Reference in ToolContext**
- Add `agent?: Agent` to ToolContext
- Agent provides `hasFileBeenRead(path: string): boolean` method
- Tools check via `context.agent?.hasFileBeenRead()`
- Clean, extensible, follows existing patterns

**Rejected Alternatives:**
- Function in context: `getReadFiles?: () => Set<string>` - less discoverable
- Direct ThreadManager access: Too much power for tools
- Separate FileTracker service: Unnecessary abstraction

### ToolContext Simplification

While implementing this feature, we identified that ToolContext has several unused/redundant fields:
- `parentThreadId` - Never used by any tool
- `sessionId` - Never used by any tool  
- `projectId` - Never used by any tool
- `session` - Can be accessed via `agent.getFullSession()`
- `threadId` - Can be accessed via `agent.threadId`

**Simplified ToolContext:**
```typescript
export interface ToolContext {
  workingDirectory?: string;  // Used by file tools and bash
  toolTempDir?: string;       // Used by bash for output files
  agent?: Agent;              // Central access point for everything else
}
```

## Implementation Plan

### Phase 1: ToolContext Cleanup

1. **Update ToolContext interface** (`src/tools/types.ts`)
   - Remove: `parentThreadId`, `sessionId`, `projectId`, `session`, `threadId`
   - Add: `agent?: Agent`

2. **Update Agent to pass itself** (`src/agents/agent.ts`)
   - Modify both places where `toolContext` is created
   - Add `agent: this` to the context object
   - Remove the removed fields

3. **Update affected tools**
   - **Delegate tool** (`src/tools/implementations/delegate.ts`)
     - Change `context?.threadId` → `context.agent?.threadId`
     - Change `context?.session` → `await context.agent?.getFullSession()`
   
   - **Task management tools** (`src/tools/implementations/task-manager/tools.ts`)
     - Update all 6 tools (Create, Query, Complete, Update, Delete, Note)
     - Change `context?.threadId` → `context.agent?.threadId`
     - Change `context?.session` → `await context.agent?.getFullSession()`

### Phase 2: File Read Tracking

1. **Add `hasFileBeenRead` method to Agent** (`src/agents/agent.ts`)
   ```typescript
   public hasFileBeenRead(filePath: string): boolean {
     const events = this._threadManager.getEvents(this._threadId);
     
     for (let i = 0; i < events.length; i++) {
       const event = events[i];
       
       if (event.type === 'TOOL_CALL' && event.data.name === 'file_read') {
         const toolCallId = event.data.id;
         const path = event.data.arguments['path'] as string;
         
         // Look for corresponding successful TOOL_RESULT
         for (let j = i + 1; j < events.length; j++) {
           const resultEvent = events[j];
           if (resultEvent.type === 'TOOL_RESULT' && 
               resultEvent.data.id === toolCallId) {
             if (!resultEvent.data.isError && path === filePath) {
               return true;
             }
             break;
           }
         }
       }
     }
     return false;
   }
   ```

2. **Update file-write tool** (`src/tools/implementations/file-write.ts`)
   ```typescript
   // In executeValidated, after resolving path
   if (existsSync(resolvedPath) && context.agent) {
     if (!context.agent.hasFileBeenRead(resolvedPath)) {
       return this.createError(
         `File ${args.path} exists but hasn't been read in this conversation. ` +
         `Use file_read to examine the current contents before overwriting.`
       );
     }
   }
   ```

3. **Update file-insert tool** (`src/tools/implementations/file-insert.ts`)
   ```typescript
   // In executeValidated, after stat(resolvedPath)
   if (context.agent && !context.agent.hasFileBeenRead(resolvedPath)) {
     return this.createError(
       `File ${args.path} hasn't been read in this conversation. ` +
       `Use file_read to examine the current contents before inserting.`
     );
   }
   ```

4. **Update file-edit tool** (`src/tools/implementations/file-edit.ts`)
   ```typescript
   // In executeValidated, before reading the file
   if (context.agent && !context.agent.hasFileBeenRead(resolvedPath)) {
     return this.createError(
       `File ${args.path} hasn't been read in this conversation. ` +
       `Use file_read to examine the current contents before editing.`
     );
   }
   ```

### Phase 3: Testing

1. **Unit tests for `hasFileBeenRead`**
   - Test with no events
   - Test with successful file_read
   - Test with failed file_read (should return false)
   - Test with multiple files
   - Test exact path matching (no normalization)

2. **Integration tests for tools**
   - Test file-write blocks on unread file
   - Test file-write allows after read
   - Test file-insert blocks on unread file
   - Test file-edit blocks on unread file
   - Test that new files can be created without reading

3. **End-to-end test**
   - Create a conversation that reads a file
   - Verify write is allowed
   - Compact the thread
   - Verify write is now blocked (read history cleared)

## Migration Notes

### Breaking Changes
- Tools that directly access `context.threadId` will need to use `context.agent?.threadId`
- Tools that directly access `context.session` will need to use `await context.agent?.getFullSession()`
- Custom tools outside the codebase may need updates

### Backward Compatibility
- All ToolContext fields are optional, so missing fields won't cause crashes
- Tools already check for undefined values (e.g., `context?.threadId`)
- The agent field is optional, so tools without it will continue to work

## Security Considerations

1. **No path normalization** - We match exact paths as provided by the agent
2. **No symlink resolution** - Treated as different files
3. **Case sensitive** - Different cases are different files
4. **No force flag** - Agents must read files, no bypass option

## Performance Considerations

1. **Thread event scanning** - O(n) where n is events since last compaction
2. **No caching** - Always queries fresh to handle concurrent modifications
3. **Early termination** - Stops searching once file is found
4. **Compaction benefit** - Fewer events to scan after compaction

## Future Enhancements

1. **Performance optimization**: Could maintain a read file index in thread metadata
2. **Partial reads**: Could track line ranges read, not just files
3. **Read timestamp**: Could expire reads after certain time
4. **Directory reads**: Could consider file-list as reading directory contents

## Success Criteria

1. File modification tools prevent overwrites of unread files
2. Clear error messages guide agents to read first
3. Works correctly across agent recreations
4. No performance regression for normal operations
5. All existing tests continue to pass
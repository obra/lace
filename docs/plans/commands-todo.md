# Slash Command System Implementation Plan

## Overview

Design and implement a flexible slash command system that works across the Terminal interface and NonInteractive interface (for `--prompt` flag). The system will support both built-in system commands and user-defined commands loaded from `.lace/commands/`.

## Current State

### ✅ **Completed - Refactoring**
- Created dedicated `NonInteractiveInterface` for `--prompt` handling
- Removed duplicate `handleSinglePrompt` methods from CLI and Terminal interfaces
- Main CLI now uses `NonInteractiveInterface` for `--prompt` flag
- Old CLI interface remains untouched (as requested)

### Current Degenerate Implementation
**Terminal Interface** (`src/interfaces/terminal/terminal-interface.tsx:228-319`):
```typescript
// Hardcoded switch-case in handleSlashCommand
switch (command) {
  case "/compact": /* ... */ break;
  case "/help": /* ... */ break; 
  case "/exit": /* ... */ break;
  default: /* error */ break;
}
```

## Architecture Design

### Core Interfaces

```typescript
// Command interface - same for system and user commands
interface SlashCommand {
  name: string;
  description: string;
  aliases?: string[];
  usage?: string;
  execute(context: CommandContext): Promise<CommandResult>;
}

// Execution context provided to all commands
interface CommandContext {
  threadManager: ThreadManager;
  agent: Agent;
  interface: 'terminal' | 'non-interactive';
  output: OutputHandler;
  args: string;        // Raw args after command name
  argv: string[];      // Parsed args array
}

// Abstracted output for different interfaces
interface OutputHandler {
  system(message: string): void;
  error(message: string): void;
  success(message: string): void;
  info(message: string): void;
}
```

### Command Types

#### System Commands (Built-in)
- **`/exit`** - Quit application
- **`/help [command]`** - Show help (general or command-specific)
- **`/compact`** - Compress thread history to save tokens
- **`/status`** - Show current status (model, thread info, etc.)
- **`/model <name>`** - Switch AI models
- **`/clear`** - Clear conversation display
- **`/threads`** - List/manage conversation threads

#### User Commands (Custom)
- Stored in `~/.lace/commands/` as markdown files
- File name = command name (e.g., `review.md` → `/review`)
- Content becomes prompt template with `{args}` substitution
- Optional frontmatter for metadata

**Example: `~/.lace/commands/review.md`**
```markdown
---
description: "Review code for issues and improvements"
aliases: ["r", "check"]
usage: "/review <file_or_code>"
---

Please review the following code for potential issues, improvements, and best practices:

{args}

Focus on:
- Code quality and readability
- Performance considerations
- Security vulnerabilities
- Best practices adherence
```

## Implementation Plan

### Phase 1: Core Infrastructure
**Goal**: Replace hardcoded switch-case with extensible system

**Files to create:**
```
src/commands/
├── types.ts              # Core interfaces (SlashCommand, CommandContext, etc.)
├── parser.ts              # Parse "/cmd args" → {command, args, argv}
├── registry.ts            # CommandRegistry class for registration/lookup
├── executor.ts            # CommandExecutor class for execution flow
└── output-handlers.ts     # OutputHandler implementations
```

**Tasks:**
1. Create command interfaces and types
2. Implement command parsing (`/help arg1 arg2` → parsed structure)
3. Build command registry with registration/lookup/aliases
4. Create command executor that coordinates parsing → lookup → execution
5. Implement output handlers for Terminal and NonInteractive interfaces

### Phase 2: System Commands
**Goal**: Implement all built-in commands

**Files to create:**
```
src/commands/system/
├── exit-command.ts        # Process.exit with cleanup
├── help-command.ts        # Dynamic help from registry
├── compact-command.ts     # Thread compression
├── status-command.ts      # Current session info
├── model-command.ts       # Provider/model switching
├── clear-command.ts       # Clear conversation display
├── threads-command.ts     # Thread management
└── index.ts               # Export all system commands
```

**Tasks:**
1. Implement each system command as `SlashCommand`
2. Add comprehensive error handling and validation
3. Create dynamic help system that introspects registry
4. Add command aliases support

### Phase 3: Interface Integration
**Goal**: Replace hardcoded handlers with new system

**Integration Points:**
- **Terminal Interface**: Replace `handleSlashCommand` in `handleSubmit` callback
- **NonInteractive Interface**: Add command parsing to `executePrompt` method

**Tasks:**
1. Create `TerminalOutputHandler` that calls `addMessage()`
2. Create `NonInteractiveOutputHandler` that uses `console.log`
3. Replace hardcoded switch-case in Terminal interface
4. Add command parsing to NonInteractive interface
5. Ensure both interfaces share same command registry

### Phase 4: User Commands
**Goal**: Support custom commands from `.lace/commands/`

**Files to create:**
```
src/commands/
├── loader.ts              # Load user commands from filesystem
├── user-command.ts        # UserCommand implementation
└── watcher.ts             # File watching for live updates
```

**Tasks:**
1. Implement file loader with frontmatter parsing
2. Create `UserCommand` class that handles template substitution
3. Add file watching for live command updates
4. Handle errors gracefully (bad syntax, missing files, etc.)

### Phase 5: Autocomplete Integration
**Goal**: Extend existing autocomplete to support commands

**Tasks:**
1. Modify `FileScanner` or create `CommandScanner` 
2. `/` prefix triggers command name completion
3. Command-specific argument completion (e.g., `/model <tab>` shows available models)
4. File path completion for user commands (e.g., `/review <tab>` completes file paths)

### Phase 6: Testing & Polish
**Goal**: Comprehensive test coverage and documentation

**Tests needed:**
- Unit tests for each system command
- CommandRegistry registration/lookup/aliases
- CommandParser input parsing edge cases
- User command loading and template substitution
- Integration tests for both Terminal and NonInteractive interfaces
- Error handling scenarios

## Command Execution Flow

### Current (Degenerate)
```
User types "/compact" → hardcoded switch-case → inline implementation
```

### New Design
```
User types "/compact arg1 arg2" →
CommandParser.parse() → {command: "compact", args: "arg1 arg2", argv: ["arg1", "arg2"]} →
CommandRegistry.get("compact") → CompactCommand instance →
CompactCommand.execute(context) → threadManager.compact() + output.success()
```

### User Command Flow
```
User types "/review src/app.ts" →
CommandParser.parse() → {command: "review", args: "src/app.ts", argv: ["src/app.ts"]} →
CommandRegistry.get("review") → UserCommand instance →
UserCommand.execute() → load template → substitute {args} → agent.sendMessage(prompt)
```

## Benefits

✅ **Eliminates code duplication** between interfaces  
✅ **Extensible system** for adding new commands  
✅ **User customization** via `.lace/commands/`  
✅ **Consistent interface** across all UIs  
✅ **Type-safe** command system  
✅ **Testable** individual commands  
✅ **Future-proof** for new interfaces  
✅ **Command aliases** support  
✅ **Dynamic help** system  
✅ **Autocomplete** integration ready  

## Migration Strategy

1. **Phase 1-2**: Build new system alongside existing (no breaking changes)
2. **Phase 3**: Replace Terminal interface implementation (single PR)
3. **Phase 4-6**: Add user commands and enhancements

## Open Questions

1. **Command history**: Since slash commands become part of message history, no additional command history needed
2. **Command scoping**: Should some commands be interface-specific? (e.g., `/clear` only makes sense in Terminal)
3. **Command permissions**: Any commands that should require confirmation?
4. **Command composition**: Should commands be able to call other commands?

## Success Criteria

- [ ] All existing hardcoded commands work identically
- [ ] New commands can be added without code changes
- [ ] User commands work from `.lace/commands/`
- [ ] Both Terminal and NonInteractive interfaces support commands
- [ ] Command autocomplete works
- [ ] Comprehensive test coverage
- [ ] Zero regressions in existing functionality
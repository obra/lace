# Command System Architecture Plan v2

## Overview

Design and implement a clean command system with a simple UserInterface abstraction. Commands are interface-agnostic user actions that can be triggered via slash syntax, menu items, buttons, API endpoints, etc.

## Key Architectural Decisions

### 1. Agent is the Single Source of Truth
**Previous Problem**: Interfaces redundantly received agent, threadManager, and toolExecutor
```typescript
// Previous - redundant parameters
TerminalInterface(agent, threadManager, toolExecutor)
NonInteractiveInterface(agent, threadManager, toolExecutor)
```

**Current Solution**: Agent exposes public getters for all dependencies
```typescript
// Current - agent contains everything
TerminalInterface(agent)
NonInteractiveInterface(agent)

// Agent provides access to dependencies
agent.threadManager  // Public getter
agent.toolExecutor   // Public getter
```

### 2. Simple UserInterface Abstraction
Commands work against a minimal, clean interface:

```typescript
interface UserInterface {
  // Core state - agent contains threadManager and toolExecutor
  agent: Agent;
  
  // Simple command interface
  displayMessage(message: string): void;
  clearSession(): void;  // Recreate agent + thread
  exit(): void;
}
```

### 3. Commands Are Pure Business Logic
Commands don't know about interface types, capabilities, or presentation details:

```typescript
interface Command {
  name: string;
  description: string;
  aliases?: string[];
  execute(args: string, ui: UserInterface): Promise<void>;
}
```

## Command Examples

### Clear Command
Starts a new conversation session:
```typescript
const clearCommand: Command = {
  name: 'clear',
  description: 'Clear conversation back to system prompt',
  async execute(args: string, ui: UserInterface) {
    ui.clearSession();  // Interface handles recreating agent/thread
    ui.displayMessage('Conversation cleared');
  }
};
```

**Implementation**: 
- Create new thread
- Create new agent with that thread
- Reset interface state (messages, display, etc.)

### Help Command
Shows available commands:
```typescript
const helpCommand: Command = {
  name: 'help', 
  description: 'Show available commands',
  async execute(args: string, ui: UserInterface) {
    const helpText = generateHelpText();
    ui.displayMessage(helpText);  // Interface decides formatting
  }
};
```

**Interface-Specific Formatting**:
- **Terminal**: Could use modal, pager, or inline display
- **Web**: Could show modal dialog or sidebar
- **API**: Could return formatted JSON
- **Non-interactive**: Could use console.log

### Exit Command
```typescript
const exitCommand: Command = {
  name: 'exit',
  description: 'Exit the application',
  async execute(args: string, ui: UserInterface) {
    ui.exit();
  }
};
```

### Tool-Related Commands
Commands can access tools through the agent:
```typescript
const statusCommand: Command = {
  name: 'status',
  description: 'Show current status',
  async execute(args: string, ui: UserInterface) {
    const threadId = ui.agent.threadManager.getCurrentThreadId();
    const toolCount = ui.agent.toolExecutor.getAllTools().length;
    ui.displayMessage(`Thread: ${threadId}, Tools: ${toolCount}`);
  }
};
```

## Interface Implementations

### Terminal Interface (React Component)
```typescript
const TerminalInterfaceComponent: React.FC<TerminalInterfaceProps> = ({
  agent,
  approvalCallback,
}) => {
  // ... existing component logic

  const userInterface: UserInterface = {
    agent,
    
    displayMessage(message: string) {
      addMessage({ type: 'system', content: message, timestamp: new Date() });
    },
    
    clearSession() {
      // Create new thread and agent
      const newThreadId = agent.threadManager.generateThreadId();
      agent.threadManager.createThread(newThreadId);
      // Reset React state
      setMessages([]);
    },
    
    exit() {
      // Handle graceful shutdown
      process.exit(0);
    }
  };
};
```

### Non-Interactive Interface (Class)
```typescript
export class NonInteractiveInterface implements UserInterface {
  agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }
  
  displayMessage(message: string): void {
    console.log(message);
  }
  
  clearSession(): void {
    // Create new thread and agent
    const newThreadId = this.agent.threadManager.generateThreadId();
    this.agent.threadManager.createThread(newThreadId);
  }
  
  exit(): void {
    process.exit(0);
  }
}
```

### CLI Interface (Class)
```typescript
export class CLIInterface implements UserInterface, ApprovalCallback {
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
  }
  
  displayMessage(message: string): void {
    console.log(message);
  }
  
  clearSession(): void {
    const newThreadId = this.agent.threadManager.generateThreadId();
    this.agent.threadManager.createThread(newThreadId);
  }
  
  async exit(): void {
    await this.agent?.stop();  // Agent.stop() is async
    process.exit(0);
  }
}
```

## Command System Components

### Command Registry
```typescript
class CommandRegistry {
  private commands = new Map<string, Command>();
  private aliases = new Map<string, string>();
  
  register(command: Command): void {
    this.commands.set(command.name, command);
    command.aliases?.forEach(alias => {
      this.aliases.set(alias, command.name);
    });
  }
  
  get(name: string): Command | undefined {
    const commandName = this.aliases.get(name) || name;
    return this.commands.get(commandName);
  }
  
  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }
}
```

### Command Executor
```typescript
class CommandExecutor {
  constructor(private registry: CommandRegistry) {}
  
  async execute(input: string, ui: UserInterface): Promise<void> {
    const parsed = this.parseCommand(input);
    if (!parsed) return;
    
    const command = this.registry.get(parsed.command);
    if (!command) {
      ui.displayMessage(`Unknown command: ${parsed.command}`);
      return;
    }
    
    try {
      await command.execute(parsed.args, ui);
    } catch (error) {
      ui.displayMessage(`Command failed: ${error.message}`);
    }
  }
  
  private parseCommand(input: string): { command: string; args: string } | null {
    if (!input.startsWith('/')) return null;
    
    const parts = input.slice(1).split(' ');
    const command = parts[0];
    const args = parts.slice(1).join(' ');
    
    return { command, args };
  }
}
```

## Built-in System Commands

- **`/help [command]`** - Show help (general or command-specific)
- **`/clear`** - Clear conversation back to system prompt  
- **`/exit`** - Quit application
- **`/status`** - Show current status (model, thread info, etc.)
- **`/model <name>`** - Switch AI models
- **`/compact`** - Compress thread history to save tokens

## User Commands (Future)

Commands can be loaded from:
1. **Global**: `~/.lace/commands/` (LACE_DIR)
2. **Project**: `./.lace/commands/` (overlays global)

User commands are markdown files with frontmatter:
```markdown
---
description: "Review code for issues and improvements"
aliases: ["r", "check"]
---

Please review the following code:

{args}

Focus on code quality, performance, and security.
```

## Benefits

1. **Clean Separation**: Commands contain business logic, interfaces handle presentation
2. **Interface Agnostic**: Same commands work in terminal, web, API, non-interactive
3. **Simple Contract**: Minimal UserInterface abstraction with single agent dependency
4. **Extensible**: Easy to add new commands and interfaces
5. **Testable**: Mock UserInterface for testing commands
6. **Future-Proof**: Foundation for user-defined commands
7. **No Redundancy**: Agent is the single source of truth for all conversation state

## Implementation Plan

### Phase 1: Core Infrastructure
1. Define UserInterface interface
2. Implement CommandRegistry and CommandExecutor
3. Update interfaces to provide UserInterface implementation

### Phase 2: Built-in Commands
1. Implement system commands (help, clear, exit, status, compact)
2. Integrate command executor into interfaces
3. Replace hardcoded command handling (currently in TerminalInterface and CLIInterface)

### Phase 3: User Commands
1. Design user command loading from `.lace/commands/`
2. Implement template substitution
3. Add command autocomplete

### Phase 4: Polish
1. Error handling and validation
2. Command aliases support
3. Comprehensive testing

## Current State

### ✅ **Completed - Architecture Refactoring**
- Agent now exposes public `toolExecutor` and `threadManager` getters
- All interface constructors simplified to single `agent` parameter
- Agent.stop() is async and handles cleanup of dependencies
- Eliminates redundant parameter passing

### Current Degenerate Implementation
**Terminal Interface** (`src/interfaces/terminal/terminal-interface.tsx:256-312`):
```typescript
// Hardcoded switch-case in handleSlashCommand
switch (command) {
  case "/compact": /* ... */ break;
  case "/help": /* ... */ break; 
  case "/exit": /* ... */ break;
  default: /* error */ break;
}
```

**CLI Interface** (`src/cli/interface.ts:144-183`):
```typescript
// Hardcoded switch-case in handleSlashCommand
switch (command) {
  case "/compact": /* ... */ break;
  case "/help": /* ... */ break; 
  default: /* unknown command */ break;
}
```

## Success Criteria

- [ ] All existing hardcoded commands work identically
- [ ] Commands work across all interface types  
- [ ] Clean, minimal UserInterface abstraction
- [ ] Foundation ready for user-defined commands
- [ ] Zero regressions in existing functionality
- [x] Agent is single source of truth for conversation state
- [x] No redundant parameter passing between components
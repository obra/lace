# Lace - Your lightweight agentic coding environment

## Core Architecture

### Orchestrator-Driven Agent System
- **Orchestrator Agent**: Primary agent that analyzes tasks and chooses appropriate models/agents
- **Specialized Subagents**: Focused workers assigned specific models and roles by orchestrator
- **Model Selection**: Calling agent decides which model to use based on task complexity
- **Memory Agents**: Previous generation agents kept alive as queryable memory oracles

### Agent Roles & Model Assignment
- **Planning**: `claude-3-5-sonnet-20241022` or `o3-mini` for complex task breakdown
- **Execution**: `claude-3-5-haiku-20241022` for fast, straightforward tasks  
- **Reasoning**: `claude-3-5-sonnet-20241022` for deep analysis and debugging
- **Memory**: Previous generation agents for historical context queries

### Multi-Generational Memory System
- **Active Context**: Current conversation with primary agent (monitored for capacity)
- **Memory Agents**: Previous agent generations available for detailed historical queries
- **Conversation Database**: Persistent storage of full conversation history
- **Context Handoff**: At 20% remaining capacity, spawn new primary agent with compressed context

### Essential Tools (MVP)
1. **Shell execution** - Run system commands
2. **File operations** - Read/write/edit files with atomic multi-file support
3. **JavaScript evaluation** - Computational capabilities without file I/O overhead
4. **Conversation persistence** - Store and query all interactions
5. **Task tracking** - Persistent todo lists and project state
6. **Basic text search** - Find content across files
7. **Snapshot safety net** - Development-time safety with automatic project state capture

### Snapshot Safety Net System ✅ COMPLETE
**Development-time safety net using separate git repository for automatic project state capture**

#### Core Components (Phase 1) ✅
- **GitOperations**: Git management with custom separate git-dir (`.lace/history-snapshot-dotgit`)
- **SnapshotManager**: Coordinates snapshot creation, metadata, and lifecycle management
- **Automatic Capture**: Pre/post tool execution snapshots with conversation context
- **Manual Checkpoints**: User-initiated snapshots with descriptions
- **Metadata System**: Rich metadata including tool context, performance metrics, conversation state

#### Architecture
```
.lace/
├── history-snapshot-dotgit/        # Separate git repository for snapshots
├── snapshots/
│   ├── index.json                  # Fast snapshot catalog
│   └── metadata/                   # Individual snapshot metadata files
└── snapshot-config.json           # Configuration and retention policies
```

#### Features ✅
- **Time-travel Recovery**: Restore project to any previous state without polluting main git
- **Configurable Retention**: Automatic cleanup based on age, count, and type
- **Performance Optimized**: Exclusion patterns, compression, background operations
- **Safety First**: Atomic operations, validation, preview modes
- **Rich Context**: Captures conversation turns, tool usage, system state

#### Phase 2: Context Integration ✅ COMPLETE
- **ConversationDB Integration**: ✅ Capture conversation context and history
- **ActivityLogger Integration**: ✅ Correlate snapshots with logged activities  
- **ContextCapture System**: ✅ Rich metadata enrichment with conversation and activity data
- **Semantic Enhancement**: ✅ Tool categorization, search terms, and contextual hints
- **Graceful Degradation**: ✅ Fallback to legacy context on errors

#### Phase 3: Tool Integration ✅ COMPLETE
- **ToolRegistry Integration**: ✅ Automatic pre/post-tool snapshots with `callToolWithSnapshots()`
- **Rich Tool Metadata**: ✅ Enhanced tool call tracking with execution IDs and timestamps
- **Activity Logging Integration**: ✅ Coordinated logging of tool execution and snapshot events
- **Configuration Support**: ✅ Configurable snapshot behavior (pre/post/error snapshots)
- **Graceful Degradation**: ✅ Backwards compatibility when snapshot manager not available

#### Phase 4: Recovery Operations ✅ COMPLETE
- **RestoreOperations Class**: ✅ Comprehensive snapshot restoration and recovery functionality
- **Snapshot Browsing**: ✅ List, filter, and inspect available snapshots with detailed metadata
- **Restoration Preview**: ✅ Preview changes before restoring with diff analysis and safety checks
- **Full Project Restoration**: ✅ Complete project state restoration from any snapshot
- **Selective File Restoration**: ✅ Restore specific files from snapshots without full restoration
- **Safety Validation**: ✅ Working tree checks, backup creation, and force mode support
- **Restoration History**: ✅ Track restoration operations with rollback capabilities
- **Smart Recommendations**: ✅ AI-driven suggestions for optimal restoration points
- **Related Snapshot Discovery**: ✅ Find pre/post tool pairs and time-correlated snapshots

#### Future Phases
- **CLI Commands**: User interface for browsing and restoring snapshots

### Context Management
- **Tool Output Summarization**: Subagents return insights, not raw output
- **Relevance Filtering**: Keep only contextually important information in working memory
- **Proactive Management**: Monitor and manage context continuously, not reactively
- **Seamless Handoff**: New agent instances inherit compressed state without losing access to detail

### Technical Stack
- **Runtime**: Node.js (ES modules)
- **Database**: SQLite for conversation persistence
- **CLI Framework**: Commander.js for command parsing
- **JavaScript Sandbox**: vm2 for safe evaluation
- **Git Operations**: simple-git for reliable git management
- **Testing Framework**: Node.js built-in test runner with comprehensive test harness
- **Context Limits**: Pulled from model API, not hardcoded

## Key Principles
- **Context pollution prevention**: Delegate tool execution to avoid filling main thread with outputs
- **Persistent memory**: Never forget user interactions or project context
- **Simple delegation**: Subagents do work and die, no complex inter-agent communication
- **Computational agent**: JavaScript evaluation makes agent computational, not just conversational

## MVP Goals
- Interactive console interface
- Multi-generational agent handoff working
- Persistent conversation storage
- Basic tool ecosystem functional
- Demonstration of self-contained task completion with memory retention
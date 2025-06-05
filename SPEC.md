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
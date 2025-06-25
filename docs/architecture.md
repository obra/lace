# Lace Architecture Documentation

## Overview

Lace is a modular AI coding assistant built with TypeScript and Node.js. The architecture follows event-sourcing patterns with clean separation of concerns, designed to support multiple AI models and interfaces. The system is built around immutable event sequences that can be reconstructed into conversation state, enabling resumable conversations and multiple interface types.

## Core Design Principles

### Event-Sourcing Architecture
All conversations are stored as immutable event sequences that can be reconstructed into conversation state. This enables:
- Resumable conversations across process restarts
- Multiple interface types (CLI, web, API) working with same data
- Complete audit trail of all interactions
- Stateless operation - any component can rebuild state from events

### Provider Abstraction
Clean abstraction layer supporting multiple AI providers:
- Anthropic Claude 
- OpenAI GPT models
- LMStudio (local models)
- Ollama (local models)

### Tool System
Model-agnostic tool interface supporting multiple AI providers with comprehensive tool implementations for file operations, bash execution, and delegation.

## System Components

### System Components

**Entry Point (`src/cli.ts`)**: CLI orchestration, environment setup, component wiring

**Agent System (`src/agents/agent.ts`)**: Core conversation engine with event-driven architecture and state machine

**Thread Management (`src/threads/`)**: Event storage, persistence, conversation reconstruction with SQLite backend and memory fallback

**Provider System (`src/providers/`)**: Normalized interface for AI providers (Anthropic, OpenAI, LMStudio, Ollama) with format conversion

**Tool System (`src/tools/`)**: Central execution, approval workflow, file operations, system operations, workflow tools

**Interface System (`src/interfaces/`)**: Rich terminal UI, event processing, non-interactive mode

**Configuration (`src/config/`)**: Dynamic prompt generation, directory management

**Token Management (`src/token-management/`)**: Usage tracking, budget enforcement

## Data Flow Architecture

### Primary Conversation Flow
```
User Input → USER_MESSAGE Event → Agent Processing →
Provider API Call → AGENT_MESSAGE Event → Tool Extraction →
TOOL_CALL Events → Tool Execution → TOOL_RESULT Events →
Next Agent Processing (recursive) → Response Complete
```

### Event Processing Pipeline
```
ThreadEvents (Persisted) → ThreadProcessor (Cached) → Timeline Items → UI Display
                        ↗
Ephemeral Messages (Streaming) → Real-time Processing → Timeline Merge
```

### Key Architectural Patterns

**Provider Integration**: Generic format ↔ Provider-specific format conversion

## State Management

### Agent State Machine
- **idle**: Ready for new input
- **thinking**: Processing user request
- **streaming**: Receiving streamed response
- **tool_execution**: Running tools
- **conversation_complete**: Turn finished

### Thread State
- **Events**: Immutable sequence of all interactions
- **Current Thread**: Active conversation context
- **Delegate Threads**: Sub-conversations for complex tasks

### UI State
- **Timeline**: Processed events for display
- **Ephemeral Messages**: Real-time streaming content
- **Tool Approval**: Pending approval requests

## Architectural Strengths

The event-sourcing foundation and three-layer separation (Data/Logic/Interface) enable:
- **Extensibility**: Add new interfaces, providers, tools without core changes
- **Resilience**: Graceful degradation and error recovery
- **Testability**: Comprehensive testing across unit/integration/E2E levels
- **Performance**: Caching, optimized queries, incremental processing

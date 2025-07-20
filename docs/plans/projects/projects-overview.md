# Multi-Project Architecture Complete Implementation Plan

## Overview

This plan implements full multi-project support for Lace, allowing users to organize AI sessions into projects with separate working directories, configurations, and tool policies. The implementation is divided into three phases, with detailed TDD instructions for each feature.

**Architecture**: Projects → Sessions → Threads

**CRITICAL RULES**:
1. Follow TDD strictly - Write failing tests FIRST
2. Never mock the behavior you're testing  
3. Commit after each passing test
4. Use existing patterns (DRY)
5. Build only what's needed for the current test (YAGNI)

## Background for New Engineers

### What is Lace?
Lace is an AI coding assistant with:
- **Event-sourcing**: All conversations stored as immutable events
- **Three layers**: Data (SQLite) → Logic (Agent/Session) → Interface (Web/CLI)
- **Stateless design**: Everything can be rebuilt from events

### Key Concepts You Need to Know
- **Thread**: A conversation in the database (has events)
- **Session**: A work session containing multiple threads (stored in separate sessions table)
- **Agent**: A child thread with an AI assistant
- **ThreadManager**: Handles thread CRUD and events
- **ToolExecutor**: Runs tools with approval flow
- **ToolContext**: Data passed to tools during execution

### Current State
- ✅ **Projects and Sessions implemented**: Full hierarchy with Projects → Sessions → Threads
- ✅ **Global persistence**: All managers use centralized `getPersistence()` - no dbPath parameters
- ✅ **Working directory support**: Project-level working directories with session overrides
- ✅ **Database schema maturity**: 6 migrations implemented with proper foreign key relationships
- ✅ **Entity classes**: Project and Session classes fully implemented with comprehensive APIs
- 🔄 **Tool policies**: Not yet implemented (Phase 2 feature)

## Database Architecture

### ✅ IMPLEMENTED: Current Database Architecture
```
projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
sessions (id, project_id, name, description, configuration, status, created_at, updated_at)
threads (id, session_id, project_id, created_at, updated_at, metadata)
events (id, thread_id, type, timestamp, data)
tasks (id, title, description, status, priority, assignee_id, thread_id, created_at, updated_at)
task_notes (id, task_id, author, content, timestamp)
```

### Legacy Architecture (Migrated)
```
threads (id, created_at, updated_at, metadata) 
  - Sessions identified by metadata: { isSession: true }
  - Mixed session and thread data in same table
```

### ✅ IMPLEMENTED: Architecture Benefits
1. **✅ Sessions Table**: Separate table for session persistence with proper relationships
2. **✅ Proper Foreign Keys**: sessions.project_id → projects.id, threads.session_id → sessions.id
3. **✅ Session-Thread Relationship**: One session can have multiple threads (agent delegation)
4. **✅ Clean Separation**: Session data in sessions table, conversation data in threads table
5. **✅ Task Management**: Integrated task system with notes and thread associations
6. **✅ Global Persistence**: Single `DatabasePersistence` instance with `getPersistence()`

## Implementation Phases

### ✅ Phase 1: MVP - Basic Project Support (COMPLETED)
- ✅ Database schema with sessions table (6 migrations implemented)
- ✅ Project and session persistence layers (`Project` and `Session` classes)
- ✅ Basic project/session CRUD operations (full API implemented)
- ✅ Working directory support in tools (`ToolContext` and global persistence)
- 🔄 Basic web API endpoints (partially implemented)

### 🔄 Phase 2: Configuration & Policies (IN PROGRESS)
- 🔄 Project-level configuration management
- 🔄 Tool policy enforcement per project
- ✅ Session working directory overrides (implemented)
- 🔄 Configuration API endpoints
- 🔄 Session update endpoints

### 🔄 Phase 3: Advanced Features (PLANNED)
- 🔄 Token budget management per project
- 🔄 Custom prompt templates
- 🔄 Environment variables per project
- 🔄 Rich session/agent configuration
- 🔄 Project settings UI

## Common Pitfalls to Avoid

1. **Don't confuse sessions with threads**: Sessions are containers, threads are conversations
2. **Don't use metadata for session identification**: Use proper foreign key relationships
3. **Don't mix session and thread data**: Keep them in separate tables
4. **Don't forget migration**: Existing "session threads" need to be migrated to sessions table
5. **Don't break event sourcing**: Threads still contain events, sessions contain configuration

## Success Metrics

- Users can create projects with different working directories
- Sessions are properly grouped under projects
- Multiple threads can exist per session
- Tool policies are enforced per project
- Configuration is inherited project → session → thread
- Migration preserves existing data without corruption
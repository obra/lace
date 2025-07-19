# Multi-Project Architecture Implementation Plan

This plan has been split into focused phase files for better organization and maintainability.

## Plan Structure

### [📋 Overview](./projects-overview.md)
- Project background and architecture
- Database schema design
- Key concepts and terminology
- Success metrics

### [🚀 Phase 1: MVP - Basic Project Support](./phase1-mvp.md)
- Database schema with sessions table
- Session and project persistence layers
- Working directory support
- Basic web API endpoints
- Core session/project management

### [⚙️ Phase 2: Configuration & Policies](./phase2-configuration.md)
- Project configuration inheritance
- Tool policy enforcement
- Session working directory overrides
- Configuration API endpoints
- Session update capabilities

### [🔧 Phase 3: Advanced Features](./phase3-advanced.md)
- Token budget management
- Custom prompt templates
- Environment variables per project
- Rich session/agent configuration
- Project settings UI

## Quick Start

1. **Read the [Overview](./projects-overview.md)** to understand the architecture
2. **Start with [Phase 1](./phase1-mvp.md)** for core functionality
3. **Progress through phases** based on your needs
4. **Follow TDD approach** as outlined in each phase

## Key Architectural Change

⚠️ **IMPORTANT**: This plan corrects a fundamental architectural misunderstanding:

**OLD (Incorrect)**: Sessions were stored as threads with `{ isSession: true }` metadata
**NEW (Correct)**: Sessions are stored in a separate `sessions` table with proper foreign key relationships

### Database Architecture
```
projects (id, name, description, working_directory, configuration, is_archived, created_at, last_used_at)
sessions (id, project_id, name, description, configuration, status, created_at, updated_at)
threads (id, session_id, created_at, updated_at, metadata)
events (id, thread_id, type, timestamp, data)
```

### Relationship Hierarchy
```
Projects → Sessions → Threads → Events
```

This provides proper separation of concerns and relational integrity.

## Implementation Rules

1. **Follow TDD strictly** - Write failing tests FIRST
2. **Never mock the behavior you're testing**
3. **Commit after each passing test**
4. **Use existing patterns** (DRY)
5. **Build only what's needed** for the current test (YAGNI)

## Migration Strategy

The plan includes complete migration from the old architecture to the new one:
- Migration V6 creates the sessions table
- Existing session threads are converted to proper sessions
- Thread metadata is cleaned up
- Foreign key relationships are established

## Testing Strategy

Each phase includes comprehensive test coverage:
- **Unit Tests**: Individual component behavior
- **Integration Tests**: Cross-component interactions
- **E2E Tests**: Full workflow testing
- **Migration Tests**: Data integrity validation

## Support

For questions or issues during implementation:
1. Check the specific phase documentation
2. Review the test specifications
3. Ensure proper database migration
4. Verify foreign key relationships
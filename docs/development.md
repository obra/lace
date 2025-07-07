# Development Guide

This guide covers the development workflow for Lace, including Docker setup and other non-obvious development patterns.

## Docker Development Environment

### Quick Start

```bash
# Build and start the development container
docker-compose up -d

# Get a shell in the container
docker-compose exec lace-dev bash

# Inside the container, install dependencies
npm install

# Build and run
npm run build
npm start
```

### What the Docker Setup Provides

- **Isolated node_modules**: The container uses a Docker volume for `node_modules`, so it won't conflict with your host checkout
- **LMStudio connectivity**: Port 1234 is forwarded to connect to LMStudio running on your host machine
- **Persistent development**: Source code is mounted for live editing, but build artifacts stay in the container
- **Build toolchain**: Includes TypeScript, build-essential, Python for native modules, and development tools

### Docker Commands

```bash
# Start the development environment
docker-compose up -d

# Get a shell in the running container  
docker-compose exec lace-dev bash

# Stop the development environment
docker-compose down

# View container logs
docker-compose logs -f lace-dev

# Rebuild the container (if Dockerfile changes)
docker-compose build
```

### Inside the Container

Once you have a shell in the container:

```bash
# Install/update dependencies
npm install

# Build the project
npm run build

# Run the CLI
npm start

# Run tests
npm test

# Lint and format
npm run lint
npm run format
```

## Development Workflow

### Testing Requirements

Lace follows a strict testing policy - ALL projects MUST have unit tests, integration tests, AND end-to-end tests. Follow TDD:

1. Write a failing test
2. Run the test to confirm it fails
3. Write minimal code to make it pass
4. Refactor while keeping tests green

### Pre-commit Hooks

The project has pre-commit hooks that automatically run:
- ESLint checking and auto-fix
- Prettier formatting
- Related tests

Never skip or disable pre-commit hooks.

### Code Standards

- Files must start with `// ABOUTME:` comments explaining their purpose
- Use strict TypeScript - never `any`, prefer `unknown` with type guards
- Make the smallest reasonable changes to achieve the desired outcome
- Match the style of surrounding code
- Never remove code comments unless they're actively false

### Import Style

Use `~/*` path aliases for all internal imports instead of relative paths:

```typescript
// ✅ Good: Use ~ alias
import { Agent } from '~/agents/agent.js';
import { ToolExecutor } from '~/tools/executor.js';
import { TimelineEntry } from '~/interfaces/terminal/components/ui/TimelineEntry.js';

// ❌ Bad: Relative paths
import { Agent } from '../../agents/agent.js';
import { ToolExecutor } from '../tools/executor.js';
import { TimelineEntry } from '../../../ui/TimelineEntry.js';
```

Benefits:
- **Readable**: Clear what module you're importing
- **Refactor-safe**: Imports don't break when moving files
- **Consistent**: All imports follow the same pattern
- **Maintainable**: Easier to track dependencies

The `~` prefix maps to `src/` via TypeScript path mapping in `tsconfig.json`.

### Architecture Patterns

- **Event-sourcing**: All conversations are immutable event sequences
- **Stateless operation**: Any component can rebuild state from events
- **Provider abstraction**: Clean separation between generic and provider-specific formats
- **YAGNI**: Don't add features we don't need right now

### LMStudio Integration

When running in Docker, Lace can connect to LMStudio on your host machine:
- LMStudio should be running on host port 1234
- The container forwards this port automatically
- Use `host.docker.internal` as the hostname when configuring connections

### Debugging

- Never use `console.log` - use the logger system
- Inspect logs after runs rather than during development
- The UI is a full terminal application, so interactive debugging is limited
- Consider refactoring components into smaller, testable pieces
- Ask for help testing UI components when needed

### Memory and Context

- Use the journal tool to capture insights and failed approaches
- Search the journal for relevant past experiences before starting complex tasks
- Document architectural decisions and their outcomes
- Track user feedback patterns to improve collaboration

## Common Tasks

### Adding New Tools

1. Implement the `Tool` interface in `src/tools/implementations/`
2. Register with `ToolRegistry` in main initialization
3. Provide `name`, `description`, `input_schema`, and `executeTool()` method

### Provider Development

All providers must implement the base provider interface and handle:
- Format conversion between generic and provider-specific APIs
- Streaming support where available
- Error handling and graceful degradation

### Event System Development

- Events must be immutable after creation
- All state changes go through events
- Events must be processed in sequence
- Use discriminated unions for type-safe events
- Fail fast on unknown event types
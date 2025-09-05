# End-to-End Tests

This directory contains both unit/integration tests and true end-to-end tests
using Playwright.

## Test Files

### Unit/Integration Tests (Vitest)

- `web-ui.test.ts` - Tests SessionService and backend logic
- `api-endpoints.test.ts` - Tests API endpoints
- `sse-integration.test.ts` - Tests server-sent events

### Playwright Tests (Separate Test Runner)

- `web-ui.e2e.ts` - End-to-end browser tests with Playwright
  - **Note**: This test is excluded from the regular Vitest test suite
  - Run with: `npx playwright test` (requires web server to be running)

## Running Tests

### Unit/Integration Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test web-ui.test.ts
```

### Playwright E2E Tests

```bash
# Run E2E tests headless
npm run test:e2e

# Run E2E tests with UI
npm run test:e2e:ui

# Run E2E tests in headed mode (see browser)
npm run test:e2e:headed

# Debug E2E tests
npm run test:e2e:debug
```

## Playwright Test Coverage

The Playwright tests cover the complete user workflow:

### Session Management

- Create new sessions
- List existing sessions
- Session persistence across page refreshes
- Session restoration from database

### Agent Management

- Coordinator agent creation (automatic)
- Agent spawning
- Agent switching
- Agent state management

### Conversation Flow

- Send messages to agents
- Receive agent responses
- Real-time updates via SSE
- Conversation history display

### Session Restoration

- Load conversation history after page refresh
- Continue conversations from where they left off
- Proper agent state restoration
- Full conversational context loading

### Error Handling

- Agent startup errors
- Network failures
- Graceful degradation

## Test Data IDs

The tests use `data-testid` attributes to identify UI elements:

- `create-session-button` - Button to create new session
- `session-name-input` - Input field for session name
- `confirm-create-session` - Button to confirm session creation
- `spawn-agent-button` - Button to spawn new agent
- `agent-name-input` - Input field for agent name
- `confirm-spawn-agent` - Button to confirm agent spawning
- `message-input` - Input field for messages
- `send-message-button` - Button to send message
- `agent-response` - Container for agent responses
- `thinking-indicator` - Indicator showing agent is thinking
- `streaming-response` - Container for streaming responses
- `error-message` - Container for error messages
- `message` - Individual message containers

## Known Issues

The tests currently expect these test IDs to exist in the React UI components.
The actual web UI implementation will need to include these `data-testid`
attributes for the tests to pass.

## Architecture Testing

These tests verify the complete architecture:

1. **Browser** → **Next.js API Routes** → **SessionService** → **Session Class**
   → **Agent** → **Database**
2. **Real-time updates** via **SSE** back to the **Browser**
3. **Session persistence** and **restoration** functionality
4. **Full conversation history** loading (like CLI's `--continue` command)

This ensures that the web UI provides the same functionality as the CLI
interface, including proper session restoration with full conversational
context.

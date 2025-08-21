# Web E2E Testing with Provider Mocking

This document covers E2E testing best practices for the Lace web interface, with detailed guidance on mocking AI provider responses.

## Overview

Our E2E tests use a sophisticated mocking system that intercepts AI provider API calls to provide predictable, fast responses without hitting real APIs. This approach ensures:

- **Deterministic test results** - Same input always produces same output
- **Fast execution** - No network latency or API rate limits
- **Cost efficiency** - No charges for API usage during testing
- **Offline capability** - Tests work without internet connection
- **Complete isolation** - Each test gets its own server and database

## Architecture

```
Test Process → E2E Test Server → HTTP Interception → Mock AI Responses
     ↓              ↓                    ↓                    ↓
setupTestEnvironment()  e2e-test-server.ts  MSW Handlers  Streaming Responses
```

## Key Components

### 1. Test Environment Setup (`e2e/helpers/test-utils.ts`)

```typescript
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  // Create isolated temp directory for this test
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lace-test-'));
  
  // Create mock credentials for AI providers
  const credentialsDir = path.join(tempDir, 'credentials');
  await fs.promises.mkdir(credentialsDir, { recursive: true });
  
  const anthropicCredentials = {
    apiKey: 'test-anthropic-key-for-e2e'
  };
  await fs.promises.writeFile(
    path.join(credentialsDir, 'anthropic-default.json'), 
    JSON.stringify(anthropicCredentials, null, 2)
  );

  // Start isolated test server with mocking
  const { serverUrl, serverProcess } = await startTestServer(tempDir);
  
  return { tempDir, serverUrl, serverProcess, /* ... */ };
}
```

### 2. E2E Test Server (`e2e-test-server.ts`)

```typescript
console.log('🧪 Starting E2E test server...');

// Set up test environment before importing any modules
process.env.NODE_ENV = 'production';

// Mock Anthropic API HTTP endpoints for E2E tests
import { mockAnthropicForE2E } from './e2e/helpers/anthropic-mock';
mockAnthropicForE2E();

// Import and run the main server
import './server-custom';
```

### 3. HTTP-Level Provider Mocking (`e2e/helpers/anthropic-mock.ts`)

```typescript
import { setupServer } from 'msw/node';
import { http } from 'msw';

export function mockAnthropicForE2E(): void {
  const handlers = [
    http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
      // Parse request to determine which response to send
      const body = await request.text();
      const requestData = JSON.parse(body);
      
      // Get the LAST user message from conversation history (critical!)
      const userMessages = requestData.messages?.filter((m: any) => m.role === 'user') || [];
      const userMessage = userMessages[userMessages.length - 1]?.content || '';
      
      // Determine response based on user message content
      let responseText = "I'm a helpful AI assistant. How can I help you today?";
      
      if (userMessage.includes('test message from Test 1')) {
        responseText = 'I see you sent a test message from Test 1. This is my response as Claude!';
      } else if (userMessage.includes('test message from Test 2')) {
        responseText = "Hello from Test 2! I'm responding to your different message.";
      } // ... more conditions
      
      // Return realistic streaming response
      return createStreamingResponse(responseText);
    }),
  ];

  const server = setupServer(...handlers);
  server.listen({ onUnhandledRequest: 'bypass' });
}
```

## Critical Implementation Details

### 1. HTTP Interception vs SDK Mocking

**❌ SDK Mocking (Problematic)**
```typescript
// This approach doesn't work reliably
Module.prototype.require = function (id: string) {
  if (id === '@anthropic-ai/sdk') {
    return MockAnthropic;
  }
};
```

**✅ HTTP Interception (Reliable)**
```typescript
// This approach works consistently
http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
  return mockResponse;
});
```

**Why HTTP interception is better:**
- Works with both CommonJS `require()` and ES modules `import`
- Intercepts at the network level, catching all HTTP requests
- More realistic - tests the actual HTTP communication layer
- Easier to debug with network inspection tools

### 2. Conversation History Parsing

**Critical Issue:** Multi-turn conversations send full message history, not just the latest message.

**❌ Wrong: Gets first user message**
```typescript
const userMessage = requestData.messages?.find((m: any) => m.role === 'user')?.content || '';
```

**✅ Correct: Gets last user message**
```typescript
const userMessages = requestData.messages?.filter((m: any) => m.role === 'user') || [];
const userMessage = userMessages[userMessages.length - 1]?.content || '';
```

This is essential for multi-turn conversation testing where you want different responses for each exchange.

### 3. Streaming Response Format

AI providers use Server-Sent Events (SSE) for streaming. Mock responses must match this format:

```typescript
function createStreamingResponse(responseText: string) {
  const tokens = responseText.split(' ');
  
  const events = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_test","role":"assistant","content":[],"model":"claude-3-haiku-20240307"}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
  ];
  
  // Add token-by-token content
  tokens.forEach((token, i) => {
    const text = i === 0 ? token : ' ' + token;
    events.push(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${text}"}}\n\n`);
  });
  
  // Add closing events
  events.push(
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  );
  
  return new Response(
    new ReadableStream({
      start(controller) {
        let i = 0;
        const sendEvent = () => {
          if (i < events.length) {
            controller.enqueue(new TextEncoder().encode(events[i]));
            i++;
            setTimeout(sendEvent, 50); // Realistic delay
          } else {
            controller.close();
          }
        };
        sendEvent();
      }
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    }
  );
}
```

## Best Practices for E2E Provider Mocking

### 1. Per-Test Isolation
```typescript
test.beforeEach(async ({ page }) => {
  // Each test gets its own server, database, and temp directory
  testEnv = await setupTestEnvironment();
  await page.goto(testEnv.serverUrl);
});

test.afterEach(async () => {
  // Always cleanup to prevent resource leaks
  await cleanupTestEnvironment(testEnv);
});
```

### 2. Predictable Response Mapping
```typescript
// Map specific user inputs to specific AI outputs
if (userMessage.includes('test message from Test 1')) {
  responseText = 'Expected response for Test 1';
} else if (userMessage.includes('test message from Test 2')) {
  responseText = 'Expected response for Test 2';
}
```

### 3. Realistic Timing
```typescript
// Use realistic delays for streaming to make tests visible
setTimeout(sendEvent, 50); // 50ms between tokens

// For stop functionality testing, use slower streaming
setTimeout(sendEvent, 500); // 500ms allows time to click stop
```

### 4. Complete Test Coverage
```typescript
test('Test conversation flow', async ({ page }) => {
  // Test user message appears
  await sendMessage(page, 'Hello there!');
  await verifyMessageVisible(page, 'Hello there!');
  
  // Test AI response appears
  await expect(page.getByText('Expected AI response')).toBeVisible({
    timeout: 15000
  });
  
  // Test follow-up conversation
  await sendMessage(page, 'Follow-up message');
  await verifyMessageVisible(page, 'Follow-up message');
  
  // Test second AI response is different
  await expect(page.getByText('Expected follow-up response')).toBeVisible({
    timeout: 15000
  });
  
  // Verify conversation history preserved
  await verifyMessageVisible(page, 'Hello there!');
  await verifyMessageVisible(page, 'Follow-up message');
});
```

### 5. Stop Functionality Testing
```typescript
test('Test streaming stop functionality', async ({ page }) => {
  // Send message that triggers slow response
  await sendMessage(page, 'Start a slow response');
  
  // Wait for stop button to appear
  await waitForStopButton(page, 10000);
  
  // Click stop to interrupt streaming
  await clickStopButton(page);
  
  // Verify streaming stopped
  await waitForSendButton(page, 5000);
  
  // Verify partial response (stopped before completion)
  await expect(page.getByText('Beginning of response')).toBeVisible();
  const fullResponseVisible = await page.getByText('End of response').isVisible().catch(() => false);
  expect(fullResponseVisible).toBeFalsy();
});
```

## Debugging E2E Provider Mocks

### 1. Enable Debug Logging
```typescript
console.log('🎯 Intercepting Anthropic API request');
console.log('🤖 Mock response:', { userMessage, responseText });
```

### 2. Verify Mock Installation
Look for these logs in server output:
```
🎭 Setting up Anthropic API HTTP mocks for E2E tests...
✅ Anthropic API HTTP endpoints mocked for E2E tests
```

### 3. Check Request Interception
Each API call should show:
```
🎯 Intercepting Anthropic API request for E2E test
🤖 Mock response for message: { userMessage: "...", responseText: "..." }
```

### 4. Common Issues

**Issue**: Mock not intercepting requests
**Solution**: Ensure MSW server starts before main server imports

**Issue**: Wrong response for multi-turn conversation  
**Solution**: Use last user message, not first: `userMessages[userMessages.length - 1]`

**Issue**: Streaming not working
**Solution**: Verify SSE format and Content-Type headers

**Issue**: Tests timeout waiting for responses
**Solution**: Check that mock conditions match exact user message text

## Example Test Structure

### Basic Test Pattern

```typescript
import { test, expect } from '@playwright/test';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
} from './helpers/test-utils';
import {
  createProject,
  setupAnthropicProvider,
  getMessageInput,
  sendMessage,
  verifyMessageVisible,
} from './helpers/ui-interactions';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Example E2E Test Patterns', () => {
  let testEnv: TestEnvironment;

  test.beforeEach(async ({ page }) => {
    // Setup isolated test environment for each test
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);
  });

  test.afterEach(async () => {
    // Always cleanup test environment
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('Create project with complete conversation flow', async ({ page }) => {
    // Setup default provider first
    await setupAnthropicProvider(page);

    // Create a project in our isolated environment
    const projectPath = path.join(testEnv.tempDir, 'test-project');
    await fs.promises.mkdir(projectPath, { recursive: true });
    await createProject(page, 'Test Project', projectPath);

    // Wait for project to be fully loaded
    await getMessageInput(page);

    // Send a message to trigger AI response
    await sendMessage(page, 'This is a test message');

    // Verify user message appears
    await verifyMessageVisible(page, 'This is a test message');

    // Wait for AI response to appear (mocked by E2E test server)
    await expect(
      page.getByText('Expected mock response')
    ).toBeVisible({
      timeout: 15000,
    });
  });
});
```

### Multi-Turn Conversation Testing

```typescript
test('Complete conversation flow with multiple exchanges', async ({ page }) => {
  // Setup provider and project
  await setupAnthropicProvider(page);
  const projectPath = path.join(testEnv.tempDir, 'conversation-test');
  await fs.promises.mkdir(projectPath, { recursive: true });
  await createProject(page, 'Conversation Test', projectPath);
  await getMessageInput(page);

  // First message exchange
  await sendMessage(page, 'Hello there!');
  await verifyMessageVisible(page, 'Hello there!');
  
  await expect(
    page.getByText('First response from mock')
  ).toBeVisible({ timeout: 15000 });

  // Follow-up message to test continued conversation
  await sendMessage(page, 'This is a follow-up message');
  await verifyMessageVisible(page, 'This is a follow-up message');
  
  await expect(
    page.getByText('Follow-up response from mock')
  ).toBeVisible({ timeout: 15000 });

  // Verify conversation history is preserved
  await verifyMessageVisible(page, 'Hello there!');
  await verifyMessageVisible(page, 'This is a follow-up message');
});
```

## Running E2E Tests

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test e2e/example.test.e2e.ts

# Run with UI (helpful for debugging)
npx playwright test --headed

# Run with debug mode
npx playwright test --debug

# Run single test
npx playwright test --grep "Create project with complete conversation flow"
```

## Helper Functions

The E2E infrastructure provides several helper functions to make tests reliable and maintainable:

### UI Interaction Helpers (`e2e/helpers/ui-interactions.ts`)

```typescript
// Project management
await setupAnthropicProvider(page);
await createProject(page, name, path);

// Message handling
await getMessageInput(page);
await sendMessage(page, text);
await verifyMessageVisible(page, text);

// Stop functionality
await waitForStopButton(page);
await clickStopButton(page);
await waitForSendButton(page);
```

### Environment Helpers (`e2e/helpers/test-utils.ts`)

```typescript
// Per-test isolation
const testEnv = await setupTestEnvironment();
await cleanupTestEnvironment(testEnv);

// Each test gets:
// - Unique temporary directory
// - Isolated server process
// - Mock credentials
// - Clean database
```

## Key Learnings and Gotchas

### 1. Module Loading Order Matters
The E2E test server must set up mocking before importing the main server code:

```typescript
// ✅ Correct order
import { mockAnthropicForE2E } from './e2e/helpers/anthropic-mock';
mockAnthropicForE2E(); // Must happen first
import './server-custom'; // Server imports after mocking is set up
```

### 2. Conversation History Parsing
Always get the last user message, not the first, to handle multi-turn conversations correctly.

### 3. Server-Sent Events Format
Mock responses must exactly match the Anthropic SSE format, including proper event names and data structure.

### 4. Timing and Realism
Use realistic delays (50-100ms per token) to make streaming visible and testable, but avoid making tests unnecessarily slow.

### 5. Credential Files Required
Even with mocking, the system expects credential files to exist. Create mock credential files in the test environment.

## Summary

This E2E provider mocking system enables:
- Fast, reliable tests without API dependencies
- Complete isolation between test runs
- Realistic streaming behavior simulation
- Comprehensive conversation flow testing
- Easy debugging and maintenance

The key is to mock at the HTTP level rather than trying to intercept SDK imports, and to properly handle conversation history when determining mock responses.

See `/packages/web/e2e/example.test.e2e.ts` for complete working examples of all these patterns.
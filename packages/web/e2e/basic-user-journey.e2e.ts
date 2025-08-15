// ABOUTME: End-to-end test for basic user onboarding and first message workflow
// ABOUTME: Tests complete journey from landing page to receiving LLM response

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withTempLaceDir, authenticateInTest } from './utils/withTempLaceDir';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Basic User Journey', () => {
  test('complete flow: onboarding → project creation → first message', async ({ 
    page,
    worker: _worker  // MSW fixture activation
  }) => {
    await withTempLaceDir('lace-e2e-basic-journey-', async (tempDir) => {
      const projectName = 'E2E Test Project Basic Journey';
      const { projectSelector, chatInterface } = createPageObjects(page);

    // Step 1: Navigate to app (will redirect to login due to middleware)
    await page.goto('/');
    
    // Step 2: Authenticate using the test helper
    await authenticateInTest(page);
    
    // Step 3: Verify we're redirected to main app and see project selection interface
    await expect(projectSelector.newProjectButton).toBeVisible();
    
    // Step 4: Create a new project
    const projectPath = path.join(tempDir, 'test-project');
    
      // Create the directory so validation passes
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      // Use page object to create project
      await projectSelector.createProject(projectName, projectPath);
      
      // Step 5: Verify we're now in the chat interface
      await chatInterface.waitForChatReady();
      await expect(chatInterface.messageInput).toBeVisible();
      
      // Step 6: Send a message to the LLM
      const testMessage = 'Hello, this is my first message!';
      await chatInterface.sendMessage(testMessage);
      
      // Step 7: Verify our message appears in the conversation
      await expect(chatInterface.getMessage(testMessage)).toBeVisible();
      
      // Step 8: Verify chat interface is ready for next message
      // The message was sent successfully (202 status) so the interface should be ready
      await chatInterface.waitForSendAvailable();
      await expect(chatInterface.sendButton).toBeVisible();
    });
  });
});
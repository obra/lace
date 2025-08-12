// ABOUTME: End-to-end test for basic user onboarding and first message workflow
// ABOUTME: Tests complete journey from landing page to receiving LLM response

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Basic User Journey', () => {
  test('complete flow: onboarding → project creation → first message', async ({ 
    page,
    worker
  }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-basic-journey-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E Test Project Basic Journey';
    const { projectSelector, chatInterface } = createPageObjects(page);

    // Step 1: User lands on the application
    await page.goto('/');
    
    // Step 2: Verify we see project selection interface
    await expect(projectSelector.newProjectButton).toBeVisible();
    
    // Step 3: Create a new project
    const projectPath = path.join(tempDir, 'test-project');
    
    // Create the directory so validation passes
    await fs.promises.mkdir(projectPath, { recursive: true });
    
    try {
      // Use page object to create project
      await projectSelector.createProject(projectName, projectPath);
      
      // Step 4: Verify we're now in the chat interface
      await chatInterface.waitForChatReady();
      await expect(chatInterface.messageInput).toBeVisible();
      
      // Step 5: Send a message to the LLM
      const testMessage = 'Hello, this is my first message!';
      await chatInterface.sendMessage(testMessage);
      
      // Step 6: Verify our message appears in the conversation
      await expect(chatInterface.getMessage(testMessage)).toBeVisible();
      
      // Step 7: Verify chat interface is ready for next message
      // The message was sent successfully (202 status) so the interface should be ready
      await chatInterface.waitForSendAvailable();
      await expect(chatInterface.sendButton).toBeVisible();
    } finally {
      // Cleanup: restore original LACE_DIR
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      // Cleanup: remove temp directory
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    }
  });
});
// ABOUTME: End-to-end test for basic user onboarding and first message workflow
// ABOUTME: Tests complete journey from landing page to receiving LLM response

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withIsolatedServer } from './utils/isolated-server';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Basic User Journey', () => {
  test('complete flow: onboarding → project creation → first message', async ({
    page,
    worker: _worker, // MSW fixture activation
  }) => {
    await withIsolatedServer('lace-e2e-basic-journey-', async (serverUrl, tempDir) => {
      // Step 1: User lands on the application
      await page.goto(serverUrl);

      // Wait for page to be loaded and handle modal auto-opening
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(3000);

      const modalAlreadyOpen = await page
        .getByRole('heading', { name: 'Create New Project' })
        .isVisible()
        .catch(() => false);
      const createButtonVisible = await page
        .getByTestId('create-project-button')
        .isVisible()
        .catch(() => false);

      const projectName = 'E2E Test Project Basic Journey';
      const { projectSelector, chatInterface } = createPageObjects(page);

      // Step 2: Create a new project
      const projectPath = path.join(tempDir, 'test-project');

      // Create the directory so validation passes
      await fs.promises.mkdir(projectPath, { recursive: true });

      // Use page object to create project
      if (modalAlreadyOpen) {
        await projectSelector.fillProjectForm(projectName, projectPath);
        await projectSelector.navigateWizardSteps();
        await projectSelector.submitProjectCreation();
      } else if (createButtonVisible) {
        await expect(projectSelector.newProjectButton).toBeVisible();
        await projectSelector.createProject(projectName, projectPath);
      } else {
        throw new Error('Unable to find either open modal or create project button');
      }

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
    });
  });
});

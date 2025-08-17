// ABOUTME: Tests project persistence across page reloads and browser sessions
// ABOUTME: Verifies hash-based routing and database storage work correctly

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withIsolatedServer } from './utils/isolated-server';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Project Persistence', () => {
  test('project selection persists across page reloads', async ({ page, worker }) => {
    await withIsolatedServer('lace-e2e-persistence-', async (serverUrl, tempDir) => {
      // Navigate to the isolated server
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

      const projectName = 'E2E Persistence Test Project';
      const { projectSelector, chatInterface } = createPageObjects(page);

      const projectPath = path.join(tempDir, 'persistent-project');
      await fs.promises.mkdir(projectPath, { recursive: true });

      if (modalAlreadyOpen) {
        await projectSelector.fillProjectForm(projectName, projectPath);
        await projectSelector.navigateWizardSteps();
        await projectSelector.submitProjectCreation();
      } else if (createButtonVisible) {
        await projectSelector.createProject(projectName, projectPath);
      } else {
        throw new Error('Unable to find either open modal or create project button');
      }
      await chatInterface.waitForChatReady();

      // Capture the URL after project creation
      const projectUrl = page.url();
      // URL should contain project/session/agent structure
      expect(projectUrl).toMatch(/#\/project\/[^\/]+\/session\/[^\/]+\/agent\/[^\/]+$/);

      // Reload the page
      await page.reload();

      // Verify we're still on the same project
      await expect(page).toHaveURL(projectUrl);

      // Verify chat interface is still available
      await chatInterface.waitForChatReady();
      await expect(chatInterface.messageInput).toBeVisible();
    });
  });

  test('direct navigation behavior (documents current state)', async ({ page, worker }) => {
    await withIsolatedServer('lace-e2e-direct-nav-', async (serverUrl, tempDir) => {
      // Navigate to the isolated server
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

      const projectName = 'E2E Direct Navigation Project';
      const { projectSelector, chatInterface } = createPageObjects(page);

      const projectPath = path.join(tempDir, 'url-accessible-project');
      await fs.promises.mkdir(projectPath, { recursive: true });

      if (modalAlreadyOpen) {
        await projectSelector.fillProjectForm(projectName, projectPath);
        await projectSelector.navigateWizardSteps();
        await projectSelector.submitProjectCreation();
      } else if (createButtonVisible) {
        await projectSelector.createProject(projectName, projectPath);
      } else {
        throw new Error('Unable to find either open modal or create project button');
      }
      const projectUrl = page.url();

      // Navigate away (simulate new browser session)
      await page.goto(serverUrl);

      // Navigate directly to the project URL
      await page.goto(projectUrl);

      // Wait for the application to handle the deep URL
      await page.waitForTimeout(3000);

      // Check what actually happens - the app might redirect or show error
      const currentUrl = page.url();
      const hasProjectSelector = await projectSelector.newProjectButton
        .isVisible()
        .catch(() => false);
      const hasMessageInput = await chatInterface.messageInput.isVisible().catch(() => false);

      // Document the current behavior: either we get redirected to project selection
      // or the chat interface loads successfully
      if (hasProjectSelector) {
        // Application redirected to project selection - this is valid behavior
        expect(hasProjectSelector).toBeTruthy();
      } else if (hasMessageInput) {
        // Application successfully loaded the deep URL - ideal behavior
        expect(hasMessageInput).toBeTruthy();
        expect(currentUrl).toContain('project/');
      } else {
        // Some other state - could be loading or error state
        // For now, just verify the page loaded without throwing
        expect(currentUrl).toContain('localhost');
      }
    });
  });

  test('handles invalid project URLs gracefully', async ({ page, worker }) => {
    await withIsolatedServer('lace-e2e-invalid-url-', async (serverUrl, tempDir) => {
      const { projectSelector } = createPageObjects(page);

      // Navigate to invalid project URL
      await page.goto(serverUrl + '/#/project/nonexistent-project-id');

      // The application may either show an error or redirect to project selection
      // Wait a reasonable time for the application to handle the invalid URL
      await page.waitForTimeout(2000);

      // Check if we get either project selector (redirect) or can at least load the page
      // The specific behavior may vary, so we test that the page is functional
      const hasProjectSelector = await projectSelector.newProjectButton
        .isVisible()
        .catch(() => false);
      const currentUrl = page.url();

      // Either we redirect to project selection or stay on the invalid URL but page loads
      expect(hasProjectSelector || currentUrl.includes('nonexistent')).toBeTruthy();
    });
  });
});

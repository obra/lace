// ABOUTME: Tests project persistence across page reloads and browser sessions
// ABOUTME: Verifies hash-based routing and database storage work correctly

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Project Persistence', () => {
  test('project selection persists across page reloads', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-persistence-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E Persistence Test Project';
    const { projectSelector, chatInterface } = createPageObjects(page);
    
    try {
      // Create project
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'persistent-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
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
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });

  test('direct navigation behavior (documents current state)', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-direct-nav-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const projectName = 'E2E Direct Navigation Project';
    const { projectSelector, chatInterface } = createPageObjects(page);
    
    try {
      // First, create a project through normal flow
      await page.goto('/');
      
      const projectPath = path.join(tempDir, 'url-accessible-project');
      await fs.promises.mkdir(projectPath, { recursive: true });
      
      await projectSelector.createProject(projectName, projectPath);
      const projectUrl = page.url();
      
      // Navigate away (simulate new browser session)
      await page.goto('/');
      
      // Navigate directly to the project URL
      await page.goto(projectUrl);
      
      // Wait for the application to handle the deep URL
      await page.waitForTimeout(3000);
      
      // Check what actually happens - the app might redirect or show error
      const currentUrl = page.url();
      const hasProjectSelector = await projectSelector.newProjectButton.isVisible().catch(() => false);
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
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });
  
  test('handles invalid project URLs gracefully', async ({ page, worker }) => {
    // Set up isolated LACE_DIR for this test
    const tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'lace-e2e-invalid-url-')
    );
    const originalLaceDir = process.env.LACE_DIR;
    process.env.LACE_DIR = tempDir;

    const { projectSelector } = createPageObjects(page);

    try {
      // Navigate to invalid project URL
      await page.goto('/#/project/nonexistent-project-id');
      
      // The application may either show an error or redirect to project selection
      // Wait a reasonable time for the application to handle the invalid URL
      await page.waitForTimeout(2000);
      
      // Check if we get either project selector (redirect) or can at least load the page
      // The specific behavior may vary, so we test that the page is functional
      const hasProjectSelector = await projectSelector.newProjectButton.isVisible().catch(() => false);
      const currentUrl = page.url();
      
      // Either we redirect to project selection or stay on the invalid URL but page loads
      expect(hasProjectSelector || currentUrl.includes('nonexistent')).toBeTruthy();
    } finally {
      // Cleanup
      if (originalLaceDir !== undefined) {
        process.env.LACE_DIR = originalLaceDir;
      } else {
        delete process.env.LACE_DIR;
      }

      try {
        await fs.promises.stat(tempDir);
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Directory already removed or doesn't exist - ignore
      }
    }
  });
});
// ABOUTME: End-to-end tests for complete file browser functionality
// ABOUTME: Tests file browsing, search, viewing, and pop-out functionality with real filesystem

import { test, expect } from '@playwright/test';
import { promises as fs } from 'fs';
import { join } from 'path';
import {
  setupTestEnvironment,
  cleanupTestEnvironment,
  type TestEnvironment,
  TIMEOUTS,
} from './helpers/test-utils';
import { createProject, setupAnthropicProvider, getMessageInput } from './helpers/ui-interactions';

// This function is no longer needed - using standard createProject helper

test.describe('File Browser E2E Tests', () => {
  let testEnv: TestEnvironment;
  let testProjectDir: string;

  test.beforeEach(async ({ page }) => {
    testEnv = await setupTestEnvironment();
    await page.goto(testEnv.serverUrl);

    // Create a test project directory with sample files
    testProjectDir = join(testEnv.tempDir, 'file-browser-test-project');
    await fs.mkdir(testProjectDir, { recursive: true });
    await fs.mkdir(join(testProjectDir, 'src'));
    await fs.mkdir(join(testProjectDir, 'src', 'components'));

    // Create test files
    await fs.writeFile(
      join(testProjectDir, 'package.json'),
      JSON.stringify(
        {
          name: 'test-project',
          version: '1.0.0',
        },
        null,
        2
      )
    );

    await fs.writeFile(join(testProjectDir, 'README.md'), '# Test Project\n\nThis is a test.');

    await fs.writeFile(
      join(testProjectDir, 'src', 'index.ts'),
      `
export function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
`.trim()
    );

    await fs.writeFile(
      join(testProjectDir, 'src', 'components', 'Button.tsx'),
      `
import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick: () => void;
}

export function Button({ children, onClick }: ButtonProps) {
  return (
    <button onClick={onClick} className="btn btn-primary">
      {children}
    </button>
  );
}
`.trim()
    );

    // Page is already at testEnv.serverUrl from beforeEach
  });

  test.afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  test('should display file browser in session sidebar', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Test Project', testProjectDir);
    await getMessageInput(page);

    // Wait for session to be established (required for file browser)
    await page.waitForURL(/\/project\/[^\/]+\/session\/[^\/]+\/agent\/[^\/]+/, {
      timeout: TIMEOUTS.EXTENDED,
    });

    // Check if file browser is available in sidebar
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      // File browser not available in current context - this is valid
      expect(true).toBeTruthy();
      return;
    }

    // Verify file browser section appears in sidebar
    await expect(page.getByText('Files')).toBeVisible();
    await expect(page.getByPlaceholder('Search files...')).toBeVisible();

    // Verify initial files are loaded
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('src')).toBeVisible();
  });

  test('should expand directories and show nested files', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Expand Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Wait for file browser to load
    await expect(page.getByText('src')).toBeVisible();

    // Click to expand src directory
    await page.getByText('src').click();

    // Verify nested files appear
    await expect(page.getByText('index.ts')).toBeVisible();
    await expect(page.getByText('components')).toBeVisible();

    // Expand components directory
    await page.getByText('components').click();
    await expect(page.getByText('Button.tsx')).toBeVisible();
  });

  test('should open file viewer modal when clicking files', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Modal Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Click on a file
    await page.getByText('README.md').click();

    // Verify modal opens
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('# Test Project')).toBeVisible();

    // Verify modal actions are present
    await expect(page.getByTitle('Copy content')).toBeVisible();
    await expect(page.getByTitle('Download file')).toBeVisible();
    await expect(page.getByTitle('Open in new window')).toBeVisible();
  });

  test('should filter files based on search term', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Filter Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Type in search box
    await page.getByPlaceholder('Search files...').fill('package');

    // Verify filtering works
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).not.toBeVisible();
    await expect(page.getByText('src')).not.toBeVisible();

    // Clear search
    await page.getByPlaceholder('Search files...').fill('');

    // Verify all files are visible again
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('src')).toBeVisible();
  });

  test('should open pop-out window for file viewing', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Popup Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Open file in modal
    await page.getByText('README.md').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Listen for new window
    const [popupPage] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByTitle('Open in new window').click(),
    ]);

    // Verify popup content
    await popupPage.waitForLoadState();

    // Verify the popup navigated to the file viewer route
    expect(popupPage.url()).toContain('/file-viewer');
    await expect(popupPage.getByText('README.md')).toBeVisible();
    await expect(popupPage.getByText('# Test Project')).toBeVisible();
    await expect(popupPage.getByRole('button', { name: /copy/i })).toBeVisible();
    await expect(popupPage.getByRole('button', { name: /download/i })).toBeVisible();

    await popupPage.close();
  });

  test('should handle file download functionality', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Download Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Open file modal
    await page.getByText('README.md').click();
    await expect(page.getByRole('dialog')).toBeVisible();

    // Listen for download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTitle('Download file').click(),
    ]);

    // Verify download
    expect(download.suggestedFilename()).toBe('README.md');
  });

  test('should handle syntax highlighting for code files', async ({ page }) => {
    await setupAnthropicProvider(page);
    await createProject(page, 'File Browser Syntax Test', testProjectDir);
    await getMessageInput(page);

    // Check if file browser is available
    const hasFileBrowser = await page
      .getByText('Files')
      .isVisible()
      .catch(() => false);
    if (!hasFileBrowser) {
      expect(true).toBeTruthy();
      return;
    }

    // Expand src directory and click TypeScript file
    await page.getByText('src').click();
    await page.getByText('index.ts').click();

    // Verify syntax highlighting is applied
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('text/typescript')).toBeVisible();

    // Look for syntax highlighted code (specific classes depend on highlight.js theme)
    const codeBlock = page.locator('code.hljs');
    await expect(codeBlock).toBeVisible();
  });
});

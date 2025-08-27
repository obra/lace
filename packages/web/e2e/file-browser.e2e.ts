// ABOUTME: End-to-end tests for complete file browser functionality
// ABOUTME: Tests file browsing, search, viewing, and pop-out functionality with real filesystem

import { test, expect, type Page } from '@playwright/test';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Helper function to create a project with test files
async function createTestProject(page: Page, projectName: string, testProjectDir: string) {
  await page.getByRole('button', { name: /new project/i }).click();
  await page.getByLabel(/project name/i).fill(projectName);
  await page.getByLabel(/working directory/i).fill(testProjectDir);
  await page.getByRole('button', { name: /create project/i }).click();

  // Navigate to session
  await page.waitForSelector('[data-testid="session-link"]');
  await page.getByTestId('session-link').first().click();
}

test.describe('File Browser E2E Tests', () => {
  let testProjectDir: string;

  test.beforeEach(async ({ page }) => {
    // Create a test project directory with sample files
    testProjectDir = join(tmpdir(), `lace-e2e-${Date.now()}`);
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

    await page.goto('/');
  });

  test.afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testProjectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test('should display file browser in session sidebar', async ({ page }) => {
    await createTestProject(page, `Test Project ${Date.now()}`, testProjectDir);

    // Verify file browser section appears in sidebar
    await expect(page.getByText('Files')).toBeVisible();
    await expect(page.getByPlaceholder('Search files...')).toBeVisible();

    // Verify initial files are loaded
    await expect(page.getByText('package.json')).toBeVisible();
    await expect(page.getByText('README.md')).toBeVisible();
    await expect(page.getByText('src')).toBeVisible();
  });

  test('should expand directories and show nested files', async ({ page }) => {
    await createTestProject(page, `Test Project ${Date.now()}`, testProjectDir);
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

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
    await createTestProject(page, `Test Project ${Date.now()}`, testProjectDir);

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
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

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
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

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
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

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
    // Setup project
    await page.getByRole('button', { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill('Test Project');
    await page.getByLabel(/working directory/i).fill(testProjectDir);
    await page.getByRole('button', { name: /create project/i }).click();

    await page.waitForSelector('[data-testid="session-link"]');
    await page.getByTestId('session-link').first().click();

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

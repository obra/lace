// ABOUTME: Basic E2E tests for web UI functionality with projects
// ABOUTME: Simplified tests that work with the actual UI structure

import { test, expect } from '@playwright/test';

test.describe('Basic Web UI E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Set up test environment
    await page.addInitScript(() => {
      window.testEnv = {
        ANTHROPIC_KEY: 'test-key',
        LACE_DB_PATH: ':memory:',
      };
    });
  });

  test('should load the home page', async ({ page }) => {
    await page.goto('/');

    // Verify basic UI elements are present
    await expect(page.getByText('Lace')).toBeVisible();
    await expect(page.getByText('Projects')).toBeVisible();
    await expect(page.getByText('New Project')).toBeVisible();
  });

  test('should show project selection requirement', async ({ page }) => {
    await page.goto('/');

    // Should show message about selecting a project
    await expect(page.getByText('Select a project to get started')).toBeVisible();
  });

  test('should be able to create a project', async ({ page }) => {
    await page.goto('/');

    // Click New Project button
    await page.click('text=New Project');

    // Verify modal opened
    await expect(page.getByText('Create New Project')).toBeVisible();

    // Fill required fields
    await page.fill('#name', 'Test Project');
    await page.fill('#workingDirectory', '/tmp/test');

    // Submit form
    await page.click('button[type="submit"]');

    // Verify project was created and selected
    await expect(page.getByText('Test Project')).toBeVisible();
  });

  test('should show session creation after project selection', async ({ page }) => {
    await page.goto('/');

    // Create and select a project
    await page.click('text=New Project');
    await page.fill('#name', 'Session Test Project');
    await page.fill('#workingDirectory', '/tmp/session-test');
    await page.click('button[type="submit"]');

    // Verify session creation UI appears
    await expect(page.getByText('New Session')).toBeVisible();
    await expect(page.getByText('Sessions')).toBeVisible();
    await expect(page.getByPlaceholder('Session name...')).toBeVisible();
  });

  test('should create a session within a project', async ({ page }) => {
    await page.goto('/');

    // Create and select a project
    await page.click('text=New Project');
    await page.fill('#name', 'Full Test Project');
    await page.fill('#workingDirectory', '/tmp/full-test');
    await page.click('button[type="submit"]');

    // Create a session
    await page.fill('input[placeholder="Session name..."]', 'Test Session');
    await page.click('button:has-text("Create")');

    // Verify session was created
    await expect(page.getByText('Test Session')).toBeVisible();

    // Verify agent management appears
    await expect(page.getByText('Agents')).toBeVisible();
  });
});

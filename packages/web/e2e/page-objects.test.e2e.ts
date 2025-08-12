import { test, expect } from './fixtures/test-environment';
import { createPageObjects } from './page-objects';

test('page objects provide clean interface for UI interactions', async ({ page, testEnv }) => {
  const { projectSelector, chatInterface } = createPageObjects(page);
  
  await page.goto('/');
  
  // Use page object methods
  await projectSelector.clickNewProject();
  
  // Verify the form opened (this is an assertion in the test, not page object)
  // In simplified mode, the path input appears first
  await expect(projectSelector.projectPathInput).toBeVisible();
});
import { test, expect } from './mocks/setup';

test('essential UI elements have data-testid attributes', async ({ page }) => {
  await page.goto('/');
  
  // Verify new project button exists
  await expect(page.getByTestId('new-project-button')).toBeVisible();
  
  // Click to open project creation form
  await page.getByTestId('new-project-button').click();
  
  // Verify form elements exist
  await expect(page.getByTestId('project-path-input')).toBeVisible();
  await expect(page.getByTestId('create-project-submit')).toBeVisible();
});
import { test, expect } from './mocks/setup';

test('essential UI elements have data-testid attributes', async ({ page }) => {
  await page.goto('/');

  // Verify new project button exists
  await expect(page.getByTestId('create-project-button')).toBeVisible();

  // Click to open project creation form
  await page.getByTestId('create-project-button').click();

  // Verify directory input exists (step 2)
  await expect(page.getByTestId('project-path-input')).toBeVisible();

  // Fill in required directory to enable Continue button
  await page.getByTestId('project-path-input').fill('/tmp/test-project');

  // Navigate through wizard steps to reach submit button
  // Step 2 -> 3: Click Continue
  const continueButton = page.locator('button:has-text("Continue")');
  await expect(continueButton).toBeVisible();
  await continueButton.click();

  // Step 3 -> 4: Click Continue again
  await page.waitForTimeout(1000);
  const secondContinue = page.locator('button:has-text("Continue")');
  await expect(secondContinue).toBeVisible();
  await secondContinue.click();

  // Step 4: Verify submit button is now visible
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('create-project-submit')).toBeVisible();
});

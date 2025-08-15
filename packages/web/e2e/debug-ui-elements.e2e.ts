// ABOUTME: Debug test to understand what UI elements exist after authentication
// ABOUTME: Helps identify actual data-testid attributes available in the current UI

import { test, expect } from './mocks/setup';
import { withTempLaceDir, authenticateInTest } from './utils/withTempLaceDir';

test.describe('Debug UI Elements', () => {
  test('dump page content after authentication', async ({ page }) => {
    await withTempLaceDir('lace-e2e-debug-ui-', async (tempDir) => {
      // Navigate and authenticate
      await page.goto('/');
      await authenticateInTest(page);
      
      // Wait a moment for the page to fully load
      await page.waitForTimeout(2000);
      
      // Get the page HTML to see what elements exist
      const html = await page.content();
      console.log('\n=== PAGE HTML AFTER AUTHENTICATION ===');
      
      // Extract data-testid attributes
      const testIds = await page.locator('[data-testid]').all();
      const testIdValues = await Promise.all(
        testIds.map(async (el) => {
          const testId = await el.getAttribute('data-testid');
          const tagName = await el.evaluate(el => el.tagName);
          const text = await el.textContent();
          return `${tagName.toLowerCase()}[data-testid="${testId}"]: "${text?.slice(0, 50)}..."`;
        })
      );
      
      console.log('\n=== AVAILABLE DATA-TESTID ELEMENTS ===');
      testIdValues.forEach(testId => console.log(testId));
      
      // Look for any button-like elements
      const buttons = await page.locator('button, input[type="button"], input[type="submit"], [role="button"]').all();
      const buttonInfo = await Promise.all(
        buttons.map(async (btn) => {
          const text = await btn.textContent();
          const testId = await btn.getAttribute('data-testid');
          const className = await btn.getAttribute('class');
          return `button: "${text?.slice(0, 30)}", testid="${testId}", class="${className?.slice(0, 50)}..."`;
        })
      );
      
      console.log('\n=== ALL BUTTON-LIKE ELEMENTS ===');
      buttonInfo.forEach(btn => console.log(btn));
      
      // Look for form elements that might be project-related
      const forms = await page.locator('form, [data-testid*="project"], [data-testid*="new"], [class*="project"], [class*="new"]').all();
      const formInfo = await Promise.all(
        forms.map(async (form) => {
          const tagName = await form.evaluate(el => el.tagName);
          const testId = await form.getAttribute('data-testid');
          const className = await form.getAttribute('class');
          const text = await form.textContent();
          return `${tagName.toLowerCase()}: testid="${testId}", class="${className?.slice(0, 50)}", text="${text?.slice(0, 50)}..."`;
        })
      );
      
      console.log('\n=== PROJECT/FORM-RELATED ELEMENTS ===');
      formInfo.forEach(form => console.log(form));
      
      // Check current URL
      const currentUrl = page.url();
      console.log(`\n=== CURRENT URL ===`);
      console.log(currentUrl);
      
      // This test always passes - we're just debugging
      expect(testIdValues.length).toBeGreaterThan(0);
    });
  });
});
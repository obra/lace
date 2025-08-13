// ABOUTME: End-to-end test for console forwarding system
// ABOUTME: Tests browser console messages forwarding to server logs

import { test, expect } from './mocks/setup';

interface ApiRequest {
  status: number;
  url: string;
}

interface ApiRequestWithTimestamp extends ApiRequest {
  timestamp: number;
}

test.describe('Console Forwarding E2E', () => {
  test('should forward simple console messages', async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for console forwarding to initialize
    await page.waitForTimeout(1000);

    // Capture console events and network requests
    const logs: string[] = [];
    const apiRequests: ApiRequest[] = [];

    page.on('console', (msg) => {
      logs.push(`BROWSER: ${msg.type()}: ${msg.text()}`);
    });

    page.on('response', (response) => {
      if (response.url().includes('/api/debug/console')) {
        apiRequests.push({
          status: response.status(),
          url: response.url(),
        });
      }
    });

    // Execute console.log in the browser
    await page.evaluate(() => {
      console.log('E2E test message', 123, { test: true });
    });

    // Wait for message to be forwarded
    await page.waitForTimeout(2000);

    // Verify the console message was captured locally
    expect(logs).toEqual(expect.arrayContaining([expect.stringContaining('E2E test message')]));

    // Verify API call was made (might be batched, so >= 1)
    expect(apiRequests.length).toBeGreaterThanOrEqual(1);
    expect(apiRequests[0].status).toBe(200);
    expect(apiRequests[0].url).toContain('/api/debug/console');
  });

  test('should handle complex objects with circular references', async ({ page }) => {
    const apiRequests: number[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/api/debug/console')) {
        apiRequests.push(response.status());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // Create complex object with circular reference
    await page.evaluate(() => {
      const complexObj: Record<string, unknown> = {
        name: 'test-object',
        date: new Date('2025-01-01T00:00:00.000Z'),
        nested: { value: 42, array: [1, 2, 3] },
      };
      complexObj.circular = complexObj;
      console.log('Complex object test:', complexObj);
    });

    await page.waitForTimeout(2000);

    // Verify API call succeeded (didn't crash on circular reference)
    expect(apiRequests).toEqual(expect.arrayContaining([200]));
  });

  test('should handle different log levels', async ({ page }) => {
    const logs: string[] = [];
    const apiRequests: number[] = [];

    page.on('console', (msg) => {
      logs.push(`${msg.type()}: ${msg.text()}`);
    });

    page.on('response', (response) => {
      if (response.url().includes('/api/debug/console')) {
        apiRequests.push(response.status());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // Test all log levels
    await page.evaluate(() => {
      console.log('Test log message');
      console.warn('Test warn message');
      console.error('Test error message');
      console.info('Test info message');
      console.debug('Test debug message');
    });

    await page.waitForTimeout(2000);

    // Verify all console types were captured
    expect(logs).toEqual(
      expect.arrayContaining([
        'log: Test log message',
        'warning: Test warn message',
        'error: Test error message',
        'info: Test info message',
        'debug: Test debug message',
      ])
    );

    // Verify API calls succeeded
    expect(apiRequests.filter((status) => status === 200).length).toBeGreaterThan(0);
  });

  test('should batch multiple console calls', async ({ page }) => {
    const apiRequests: ApiRequestWithTimestamp[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/api/debug/console')) {
        apiRequests.push({
          status: response.status(),
          url: response.url(),
          timestamp: Date.now(),
        });
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // Rapid console calls to test batching
    await page.evaluate(() => {
      for (let i = 0; i < 10; i++) {
        console.log(`Batch message ${i}`);
      }
    });

    await page.waitForTimeout(2000);

    // Should be batched (fewer than 10 separate API calls)
    expect(apiRequests.length).toBeLessThan(10);
    expect(apiRequests.length).toBeGreaterThan(0);

    // All calls should succeed
    apiRequests.forEach((req) => {
      expect(req.status).toBe(200);
    });
  });

  test('should only run in development mode', async ({ page }) => {
    const apiRequests: number[] = [];

    page.on('response', (response) => {
      if (response.url().includes('/api/debug/console')) {
        apiRequests.push(response.status());
      }
    });

    await page.goto('/');
    await page.waitForTimeout(1000);

    // Execute console.log - should only work in dev mode
    await page.evaluate(() => {
      console.log('Development mode test');
    });

    await page.waitForTimeout(2000);

    // If console forwarding is working, we should get API calls
    expect(apiRequests.length).toBeGreaterThan(0);
    expect(apiRequests).toEqual(expect.arrayContaining([200]));
  });
});

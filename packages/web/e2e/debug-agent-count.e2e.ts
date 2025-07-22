// ABOUTME: Playwright test script to debug agent count display issues
// ABOUTME: Investigates network requests and UI behavior for agent counts showing as 0

import { test, expect } from '@playwright/test';

test.describe('Agent Count Investigation', () => {
  test('should investigate agent count API and UI display', async ({ page }) => {
    // Set up network request monitoring
    const networkRequests: Array<{
      url: string;
      method: string;
      response?: unknown;
      status?: number;
    }> = [];

    // Monitor all network requests
    page.on('request', (request) => {
      networkRequests.push({
        url: request.url(),
        method: request.method(),
      });
    });

    // Monitor responses, especially API calls
    page.on('response', async (response) => {
      const url = response.url();
      const request = networkRequests.find((r) => r.url === url && !r.response);
      if (request) {
        request.status = response.status();

        // Capture response data for API calls related to sessions or agents
        if (
          url.includes('/api/projects/') ||
          url.includes('/api/sessions/') ||
          url.includes('/agents')
        ) {
          try {
            const contentType = response.headers()['content-type'];
            if (contentType?.includes('application/json')) {
              request.response = await response.json();
            }
          } catch (error) {
            console.log(`Failed to parse JSON response for ${url}:`, error);
          }
        }
      }
    });

    // Monitor console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Navigate to the specific session URL
    console.log('Navigating to session URL...');
    await page.goto('http://localhost:3005/#/project/historical/session/lace_20250722_zsj197');

    // Wait for page to load and initial API calls to complete
    await page.waitForTimeout(3000);

    // Check if the page loaded successfully
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Look for elements that should display agent count
    const agentCountElements = page.locator(
      '[data-testid*="agent"], [class*="agent"], text=/agent/i'
    );
    const agentElementCount = await agentCountElements.count();
    console.log(`Found ${agentElementCount} potential agent-related elements`);

    // Try to find specific session/agent information
    const sessionInfo = page.locator(
      '[data-testid="session-info"], [class*="session"], [class*="count"]'
    );
    const sessionInfoCount = await sessionInfo.count();
    console.log(`Found ${sessionInfoCount} potential session info elements`);

    // Log all network requests that might be related to agents or sessions
    console.log('\n=== NETWORK REQUESTS ANALYSIS ===');
    const relevantRequests = networkRequests.filter(
      (req) =>
        req.url.includes('/api/projects/') ||
        req.url.includes('/api/sessions/') ||
        req.url.includes('/agents') ||
        req.url.includes('historical')
    );

    for (const req of relevantRequests) {
      console.log(`\n${req.method} ${req.url}`);
      console.log(`Status: ${req.status || 'pending'}`);
      if (req.response) {
        console.log(`Response:`, JSON.stringify(req.response, null, 2));

        // Specifically check for agentCount field in responses
        const responseStr = JSON.stringify(req.response);
        if (responseStr.includes('agentCount') || responseStr.includes('agent_count')) {
          console.log('*** FOUND AGENT COUNT DATA ***');
        }
      }
    }

    // Check specifically for the sessions list API call
    const sessionsListRequest = relevantRequests.find(
      (req) =>
        req.url.includes('/api/projects/') &&
        req.url.includes('/sessions') &&
        !req.url.includes('/sessions/lace_20250722_zsj197') // Exclude specific session requests
    );

    if (sessionsListRequest) {
      console.log('\n=== SESSIONS LIST API ANALYSIS ===');
      console.log('Sessions list request found:', sessionsListRequest.url);
      if (sessionsListRequest.response) {
        const response = sessionsListRequest.response as { sessions?: unknown[] };
        if (response.sessions && Array.isArray(response.sessions)) {
          console.log(`Sessions count: ${response.sessions.length}`);
          response.sessions.forEach((session, index) => {
            console.log(`Session ${index}:`, JSON.stringify(session, null, 2));
          });
        }
      }
    } else {
      console.log('\n=== NO SESSIONS LIST API FOUND ===');
      console.log('Available requests:');
      relevantRequests.forEach((req) => console.log(`- ${req.method} ${req.url}`));
    }

    // Log console errors
    if (consoleErrors.length > 0) {
      console.log('\n=== CONSOLE ERRORS ===');
      consoleErrors.forEach((error) => console.log(`- ${error}`));
    } else {
      console.log('\n=== NO CONSOLE ERRORS ===');
    }

    // Try to find the specific session in the UI
    const sessionElement = page.locator(`text=/lace_20250722_zsj197/i`);
    const sessionFound = (await sessionElement.count()) > 0;
    console.log(`\n=== SESSION UI ANALYSIS ===`);
    console.log(`Session element found in UI: ${sessionFound}`);

    if (sessionFound) {
      // Look for agent count near the session element
      const nearbyText = await page.locator('body').textContent();
      const sessionIndex = nearbyText?.indexOf('lace_20250722_zsj197') ?? -1;
      if (sessionIndex !== -1) {
        const contextStart = Math.max(0, sessionIndex - 200);
        const contextEnd = Math.min(nearbyText?.length ?? 0, sessionIndex + 200);
        const context = nearbyText?.slice(contextStart, contextEnd);
        console.log('Context around session:', context);
      }
    }

    // Take a screenshot for visual inspection
    await page.screenshot({ path: 'agent-count-debug.png', fullPage: true });
    console.log('\n=== SCREENSHOT TAKEN ===');
    console.log('Screenshot saved as agent-count-debug.png');

    // Check if we're on the right page/route
    const currentUrl = page.url();
    console.log(`\n=== CURRENT URL ===`);
    console.log(`Current URL: ${currentUrl}`);

    // Wait a bit more to see if any delayed requests come in
    console.log('\nWaiting for additional requests...');
    await page.waitForTimeout(2000);

    // Final network analysis
    const finalRelevantRequests = networkRequests.filter(
      (req) =>
        req.url.includes('/api/projects/') ||
        req.url.includes('/api/sessions/') ||
        req.url.includes('/agents')
    );

    console.log(`\n=== FINAL SUMMARY ===`);
    console.log(`Total network requests: ${networkRequests.length}`);
    console.log(`Relevant API requests: ${finalRelevantRequests.length}`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Agent-related UI elements: ${agentElementCount}`);

    // This test is for investigation, so we don't need assertions
    // Just ensure the page loaded
    expect(currentUrl).toContain('localhost:3005');
  });
});

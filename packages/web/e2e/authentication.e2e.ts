// ABOUTME: End-to-end tests for authentication system functionality
// ABOUTME: Tests login flow, protected route navigation, logout, token expiry, auto-login from console, session management

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { startTestServer, stopTestServer } from './utils/testServer';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Authentication E2E Tests', () => {
  let testServer: { url: string; tempDir: string; password: string };

  test.beforeAll(async () => {
    // Start isolated test server for this test file
    testServer = await startTestServer('auth-tests');
  });

  test.afterAll(async () => {
    // Clean up test server
    await stopTestServer();
  });

  test('user authentication flow - login, navigation, logout', async ({ page }) => {
    // Override baseURL to use our isolated test server
    await page.goto(testServer.url);
    
    // Step 1: User navigates to app and MUST be redirected to login
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
    
    // Step 2: Login page elements MUST be visible
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="remember-me"]')).toBeVisible();
    
    // Step 3: Wrong password MUST show error
    await page.locator('[data-testid="password-input"]').fill('wrong-password');
    await page.locator('[data-testid="login-button"]').click();
    
    // MUST show error message for wrong password
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="error-message"]')).toContainText(/invalid|incorrect|wrong/i);
    
    // Step 4: Use the test server's generated password
    await page.locator('[data-testid="password-input"]').clear();
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    
    // MUST redirect to main app after successful login
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 15000 });
    
    // Step 5: Main app MUST be accessible after login - should show project creation
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Check that we're not on the login page anymore
    await expect(page.locator('body')).not.toContainText('Sign in to Lace');
    
    // Should be in the project creation flow for new users
    await expect(page.locator('text=Projects')).toBeVisible();
  });
  
  test('protected routes require authentication', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: API endpoints MUST return 401 without authentication
    const projectsResponse = await page.request.get(`${baseURL}/api/projects`);
    expect(projectsResponse.status()).toBe(401);
    
    const sessionsResponse = await page.request.get(`${baseURL}/api/sessions`);
    expect(sessionsResponse.status()).toBe(401);
    
    const threadsResponse = await page.request.get(`${baseURL}/api/threads`);
    expect(threadsResponse.status()).toBe(401);
    
    // Step 2: Main app routes MUST redirect to login
    await page.goto(baseURL);
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
    
    // Step 3: Auth routes MUST be accessible (don't require auth)
    const statusResponse = await page.request.get(`${baseURL}/api/auth/status`);
    expect(statusResponse.status()).toBe(200);
    
    const statusData = await statusResponse.json();
    expect(statusData).toHaveProperty('authenticated');
    expect(statusData.authenticated).toBe(false);
  });
  
  test('auto-login from console simulation', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Generate one-time token (simulates server startup)
    const { generateOneTimeToken } = await import('@/lib/server/auth-tokens');
    const oneTimeToken = generateOneTimeToken();
    
    // Step 2: Navigate to app with one-time token (simulates browser opening from console)
    await page.goto(`${baseURL}/?token=${oneTimeToken}`);
    
    // Step 3: Token MUST be automatically exchanged and user logged in
    // Should redirect to main app after successful token exchange
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
    
    // Step 4: User MUST be authenticated and see main app
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    await expect(page.locator('body')).not.toContainText('Sign in to Lace');
    
    // Step 5: Token MUST be consumed (can't be used again)
    const { consumeOneTimeToken } = await import('@/lib/server/auth-tokens');
    const secondAttempt = consumeOneTimeToken(oneTimeToken);
    expect(secondAttempt).toBeNull();
  });
  
  test('session management - remember me functionality', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    await page.goto(`${baseURL}/login`);
    
    // Step 1: Login with remember me checked
    await expect(page.locator('[data-testid="remember-me"]')).toBeVisible();
    await page.locator('[data-testid="remember-me"]').check();
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    
    // Step 2: Should be logged in
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
    
    // Step 3: Check that long-term cookie was set
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(c => c.name === 'auth-token');
    
    expect(authCookie).toBeDefined();
    // Remember me should set 30-day expiry
    const expectedExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
    expect(authCookie!.expires).toBeGreaterThan(Date.now() + (25 * 24 * 60 * 60 * 1000)); // At least 25 days
  });
  
  test('project creation flow after authentication', async ({ page }) => {
    // Use isolated test server  
    const baseURL = testServer.url;
    
    // Step 1: Navigate to login and enter correct password
    await page.goto(`${baseURL}/login`);
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    
    // Step 2: Should redirect to main app after successful login
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 15000 });
    
    // Step 2: Should show project creation form (first-time user experience)
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    
    // Step 3: Verify project creation form is displayed
    await expect(page.locator('text=Projects')).toBeVisible();
    await expect(page.locator('text=Create New Project')).toBeVisible();
    await expect(page.locator('[data-testid="project-path-input"]')).toBeVisible();
    await expect(page.locator('text=Continue')).toBeVisible();
    
    // This verifies that authentication is working correctly and the user
    // is being shown the expected onboarding flow for a new workspace
  });
  
  test('logout functionality', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Login first
    await page.goto(`${baseURL}/login`);
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
    
    // Step 2: Navigate to settings and access security panel
    await expect(page.locator('[data-testid="settings-button"]')).toBeVisible();
    await page.locator('[data-testid="settings-button"]').click();
    
    await expect(page.locator('[data-testid="security-panel"]')).toBeVisible();
    
    // Step 3: Use logout functionality
    await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
    await page.locator('[data-testid="logout-button"]').click();
    
    // Step 4: MUST redirect to login and clear auth
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
    
    // Step 5: Auth cookie MUST be cleared
    const cookies = await page.context().cookies();
    const authCookie = cookies.find(c => c.name === 'auth-token');
    expect(authCookie).toBeUndefined();
    
    // Step 6: Protected routes MUST be inaccessible again
    const response = await page.request.get(`${baseURL}/api/projects`);
    expect(response.status()).toBe(401);
  });
  
  test('token expiry handling', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Set an invalid/expired token in cookies
    await page.context().addCookies([{
      name: 'auth-token',
      value: 'expired.jwt.token.invalid',
      domain: 'localhost',
      path: '/',
      httpOnly: true
    }]);
    
    // Step 2: Expired token MUST redirect to login
    await page.goto(baseURL);
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
    
    // Step 3: API calls with expired token MUST return 401
    const response = await page.request.get(`${baseURL}/api/projects`);
    expect(response.status()).toBe(401);
    
    // Step 4: Auth status MUST show not authenticated
    const statusResponse = await page.request.get(`${baseURL}/api/auth/status`);
    const statusData = await statusResponse.json();
    expect(statusData.authenticated).toBe(false);
  });
  
  test('browser navigation with authentication state', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Login successfully
    await page.goto(`${baseURL}/login`);
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
    
    // Step 2: Navigate to another page
    await page.goto(`${baseURL}/login`);
    
    // Step 3: Use browser back button - should stay authenticated
    await page.goBack();
    await expect(page).toHaveURL(new RegExp('/$'));
    
    // Step 4: Authentication state MUST persist across navigation
    const response = await page.request.get(`${baseURL}/api/projects`);
    expect(response.status()).toBe(200); // Should be authenticated
    
    // Step 5: Direct navigation to protected routes should work
    await page.goto(baseURL);
    await page.waitForLoadState('networkidle', { timeout: 5000 });
    await expect(page.locator('body')).not.toContainText('Sign in to Lace');
  });
  
  test('multiple browser tab authentication', async ({ browser }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Create shared context (same cookies)
    const context = await browser.newContext();
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    
    try {
      // Step 2: Login in first tab
      await page1.goto(`${baseURL}/login`);
      await page1.locator('[data-testid="password-input"]').fill(testServer.password);
      await page1.locator('[data-testid="login-button"]').click();
      await page1.waitForURL(new RegExp('/$'));
      
      // Step 3: Second tab MUST also be authenticated (shared cookies)
      await page2.goto(baseURL);
      await expect(page2).toHaveURL(new RegExp('/$'));
      await page2.waitForLoadState('networkidle', { timeout: 5000 });
      await expect(page2.locator('body')).not.toContainText('Sign in to Lace');
      
      // Step 4: API calls from both tabs MUST work
      const response1 = await page1.request.get(`${baseURL}/api/projects`);
      const response2 = await page2.request.get(`${baseURL}/api/projects`);
      expect(response1.status()).toBe(200);
      expect(response2.status()).toBe(200);
    } finally {
      await context.close();
    }
  });
  
  test('password reset workflow integration', async ({ page }) => {
    // Use isolated test server
    const baseURL = testServer.url;
    
    // Step 1: Login page MUST show reset instructions
    await page.goto(`${baseURL}/login`);
    await expect(page.locator('[data-testid="reset-password-info"]')).toBeVisible();
    await expect(page.locator('[data-testid="reset-password-info"]')).toContainText('--reset-password');
    
    // Step 2: Test that current password works
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
    
    // Step 3: Simulate password reset (CLI command)
    const { resetPassword } = await import('@/lib/server/auth-config');
    const newPassword = await resetPassword();
    expect(newPassword).not.toBe(testServer.password);
    
    // Step 4: Old password MUST NOT work after reset
    await page.goto(`${baseURL}/login`);
    await page.locator('[data-testid="password-input"]').fill(testServer.password);
    await page.locator('[data-testid="login-button"]').click();
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
    
    // Step 5: New password MUST work
    await page.locator('[data-testid="password-input"]').clear();
    await page.locator('[data-testid="password-input"]').fill(newPassword);
    await page.locator('[data-testid="login-button"]').click();
    await expect(page).toHaveURL(new RegExp('/$'), { timeout: 10000 });
  });
});
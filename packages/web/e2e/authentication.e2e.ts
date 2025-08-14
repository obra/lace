// ABOUTME: End-to-end tests for authentication system functionality
// ABOUTME: Tests login flow, protected route navigation, logout, token expiry, auto-login from console, session management

import { test, expect } from './mocks/setup';
import { createPageObjects } from './page-objects';
import { withTempLaceDir } from './utils/withTempLaceDir';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Authentication E2E Tests', () => {
  test('user authentication flow - login, navigation, logout', async ({ page }) => {
    await withTempLaceDir('auth-test-', async (tempDir) => {
      // Step 1: User navigates to app and MUST be redirected to login
      await page.goto('/');
      
      // Authentication middleware MUST redirect unauthenticated users to login
      await expect(page).toHaveURL('/login', { timeout: 10000 });
      
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
      
      // Step 4: Initialize auth system with known password
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const generatedPassword = await initializeAuth();
      
      // Step 5: Correct password MUST allow login and redirect
      await page.locator('[data-testid="password-input"]').clear();
      await page.locator('[data-testid="password-input"]').fill(generatedPassword);
      await page.locator('[data-testid="login-button"]').click();
      
      // MUST redirect to main app after successful login
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 6: Main app MUST be accessible after login
      await expect(page.locator('[data-testid="new-project-button"]')).toBeVisible({ timeout: 5000 });
    });
  });
  
  test('protected routes require authentication', async ({ page }) => {
    await withTempLaceDir('auth-protected-', async (tempDir) => {
      // Step 1: API endpoints MUST return 401 without authentication
      const projectsResponse = await page.request.get('/api/projects');
      expect(projectsResponse.status()).toBe(401);
      
      const sessionsResponse = await page.request.get('/api/sessions');
      expect(sessionsResponse.status()).toBe(401);
      
      const threadsResponse = await page.request.get('/api/threads');
      expect(threadsResponse.status()).toBe(401);
      
      // Step 2: Main app routes MUST redirect to login
      await page.goto('/');
      await expect(page).toHaveURL('/login', { timeout: 10000 });
      
      // Step 3: Auth routes MUST be accessible (don't require auth)
      const statusResponse = await page.request.get('/api/auth/status');
      expect(statusResponse.status()).toBe(200);
      
      const statusData = await statusResponse.json();
      expect(statusData).toHaveProperty('authenticated');
      expect(statusData.authenticated).toBe(false);
    });
  });
  
  test('auto-login from console simulation', async ({ page }) => {
    await withTempLaceDir('auth-auto-', async (tempDir) => {
      // Step 1: Initialize auth system
      const { initializeAuth } = await import('@/lib/server/auth-config');
      await initializeAuth();
      
      // Step 2: Generate one-time token (simulates server startup)
      const { generateOneTimeToken } = await import('@/lib/server/auth-tokens');
      const oneTimeToken = generateOneTimeToken();
      
      // Step 3: Navigate to app with one-time token (simulates browser opening from console)
      await page.goto(`/?token=${oneTimeToken}`);
      
      // Step 4: Token MUST be automatically exchanged and user logged in
      // Should redirect to main app after successful token exchange
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 5: User MUST be authenticated and see main app
      await expect(page.locator('[data-testid="new-project-button"]')).toBeVisible({ timeout: 5000 });
      
      // Step 6: Token MUST be consumed (can't be used again)
      const { consumeOneTimeToken } = await import('@/lib/server/auth-tokens');
      const secondAttempt = consumeOneTimeToken(oneTimeToken);
      expect(secondAttempt).toBeNull();
    });
  });
  
  test('session management - remember me functionality', async ({ page }) => {
    await withTempLaceDir('auth-session-', async (tempDir) => {
      // Step 1: Initialize auth and go to login
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      await page.goto('/login');
      
      // Step 2: Login with remember me checked
      await expect(page.locator('[data-testid="remember-me"]')).toBeVisible();
      await page.locator('[data-testid="remember-me"]').check();
      await page.locator('[data-testid="password-input"]').fill(password);
      await page.locator('[data-testid="login-button"]').click();
      
      // Step 3: Should be logged in
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 4: Check that long-term cookie was set
      const cookies = await page.context().cookies();
      const authCookie = cookies.find(c => c.name === 'auth-token');
      
      expect(authCookie).toBeDefined();
      // Remember me should set 30-day expiry
      const expectedExpiry = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
      expect(authCookie!.expires).toBeGreaterThan(Date.now() + (25 * 24 * 60 * 60 * 1000)); // At least 25 days
    });
  });
  
  test('security panel integration', async ({ page }) => {
    await withTempLaceDir('auth-security-', async (tempDir) => {
      // Step 1: Login first
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      await page.goto('/login');
      await page.locator('[data-testid="password-input"]').fill(password);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 2: Access settings
      await expect(page.locator('[data-testid="settings-button"]')).toBeVisible();
      await page.locator('[data-testid="settings-button"]').click();
      
      // Step 3: Security panel MUST be accessible
      await expect(page.locator('[data-testid="security-panel"]')).toBeVisible();
      
      // Step 4: Security panel MUST show auth information
      await expect(page.locator('[data-testid="security-panel"]')).toContainText('Authentication');
      await expect(page.locator('[data-testid="security-panel"]')).toContainText('Security');
      
      // Step 5: Change password functionality MUST be present
      await expect(page.locator('[data-testid="security-panel"]')).toContainText('Change Password');
      
      // Step 6: Session management MUST be present
      await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
      
      // Step 7: Security information MUST be displayed
      await expect(page.locator('[data-testid="security-panel"]')).toContainText('JWT tokens');
      await expect(page.locator('[data-testid="security-panel"]')).toContainText('Password-based authentication');
    });
  });
  
  test('logout functionality', async ({ page }) => {
    await withTempLaceDir('auth-logout-', async (tempDir) => {
      // Step 1: Login first
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      await page.goto('/login');
      await page.locator('[data-testid="password-input"]').fill(password);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 2: Navigate to settings and access security panel
      await expect(page.locator('[data-testid="settings-button"]')).toBeVisible();
      await page.locator('[data-testid="settings-button"]').click();
      
      await expect(page.locator('[data-testid="security-panel"]')).toBeVisible();
      
      // Step 3: Use logout functionality
      await expect(page.locator('[data-testid="logout-button"]')).toBeVisible();
      await page.locator('[data-testid="logout-button"]').click();
      
      // Step 4: MUST redirect to login and clear auth
      await expect(page).toHaveURL('/login', { timeout: 10000 });
      
      // Step 5: Auth cookie MUST be cleared
      const cookies = await page.context().cookies();
      const authCookie = cookies.find(c => c.name === 'auth-token');
      expect(authCookie).toBeUndefined();
      
      // Step 6: Protected routes MUST be inaccessible again
      const response = await page.request.get('/api/projects');
      expect(response.status()).toBe(401);
    });
  });
  
  test('token expiry handling', async ({ page }) => {
    await withTempLaceDir('auth-expiry-', async (tempDir) => {
      // Step 1: Set an invalid/expired token in cookies
      await page.context().addCookies([{
        name: 'auth-token',
        value: 'expired.jwt.token.invalid',
        domain: 'localhost',
        path: '/',
        httpOnly: true
      }]);
      
      // Step 2: Expired token MUST redirect to login
      await page.goto('/');
      await expect(page).toHaveURL('/login', { timeout: 10000 });
      
      // Step 3: API calls with expired token MUST return 401
      const response = await page.request.get('/api/projects');
      expect(response.status()).toBe(401);
      
      // Step 4: Auth status MUST show not authenticated
      const statusResponse = await page.request.get('/api/auth/status');
      const statusData = await statusResponse.json();
      expect(statusData.authenticated).toBe(false);
    });
  });
  
  test('browser navigation with authentication state', async ({ page }) => {
    await withTempLaceDir('auth-nav-', async (tempDir) => {
      // Step 1: Login successfully
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      await page.goto('/login');
      await page.locator('[data-testid="password-input"]').fill(password);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 2: Navigate to another page
      await page.goto('/login');
      
      // Step 3: Use browser back button - should stay authenticated
      await page.goBack();
      await expect(page).toHaveURL('/');
      
      // Step 4: Authentication state MUST persist across navigation
      const response = await page.request.get('/api/projects');
      expect(response.status()).toBe(200); // Should be authenticated
      
      // Step 5: Direct navigation to protected routes should work
      await page.goto('/');
      await expect(page.locator('[data-testid="new-project-button"]')).toBeVisible({ timeout: 5000 });
    });
  });
  
  test('multiple browser tab authentication', async ({ browser }) => {
    await withTempLaceDir('auth-multi-', async (tempDir) => {
      // Step 1: Initialize auth
      const { initializeAuth } = await import('@/lib/server/auth-config');
      const password = await initializeAuth();
      
      // Step 2: Create shared context (same cookies)
      const context = await browser.newContext();
      const page1 = await context.newPage();
      const page2 = await context.newPage();
      
      try {
        // Step 3: Login in first tab
        await page1.goto('/login');
        await page1.locator('[data-testid="password-input"]').fill(password);
        await page1.locator('[data-testid="login-button"]').click();
        await page1.waitForURL('/');
        
        // Step 4: Second tab MUST also be authenticated (shared cookies)
        await page2.goto('/');
        await expect(page2).toHaveURL('/');
        await expect(page2.locator('[data-testid="new-project-button"]')).toBeVisible({ timeout: 5000 });
        
        // Step 5: API calls from both tabs MUST work
        const response1 = await page1.request.get('/api/projects');
        const response2 = await page2.request.get('/api/projects');
        expect(response1.status()).toBe(200);
        expect(response2.status()).toBe(200);
      } finally {
        await context.close();
      }
    });
  });
  
  test('password reset workflow integration', async ({ page }) => {
    await withTempLaceDir('auth-reset-', async (tempDir) => {
      // Step 1: Initialize auth with original password
      const { initializeAuth, resetPassword } = await import('@/lib/server/auth-config');
      const originalPassword = await initializeAuth();
      
      // Step 2: Login page MUST show reset instructions
      await page.goto('/login');
      await expect(page.locator('[data-testid="reset-password-info"]')).toBeVisible();
      await expect(page.locator('[data-testid="reset-password-info"]')).toContainText('--reset-password');
      
      // Step 3: Test that original password works
      await page.locator('[data-testid="password-input"]').fill(originalPassword);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page).toHaveURL('/', { timeout: 10000 });
      
      // Step 4: Simulate password reset (CLI command)
      const newPassword = await resetPassword();
      expect(newPassword).not.toBe(originalPassword);
      
      // Step 5: Old password MUST NOT work after reset
      await page.goto('/login');
      await page.locator('[data-testid="password-input"]').fill(originalPassword);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 5000 });
      
      // Step 6: New password MUST work
      await page.locator('[data-testid="password-input"]').clear();
      await page.locator('[data-testid="password-input"]').fill(newPassword);
      await page.locator('[data-testid="login-button"]').click();
      await expect(page).toHaveURL('/', { timeout: 10000 });
    });
  });
});
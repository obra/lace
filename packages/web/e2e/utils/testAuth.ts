// ABOUTME: Test authentication utilities for consistent password setup across E2E tests
// ABOUTME: Ensures each test has proper auth isolation and known password state

import { initializeAuth, clearJWTSecretCache } from '@/lib/server/auth-config';

/**
 * Initialize authentication for a test with proper cleanup
 * Ensures JWT secret cache is cleared and new password is generated
 * @returns Promise<string> The generated password for this test
 */
export async function setupTestAuth(): Promise<string> {
  // Clear any cached JWT secrets to ensure clean state
  clearJWTSecretCache();
  
  // Initialize auth system with fresh password and JWT secret
  const password = await initializeAuth();
  
  return password;
}
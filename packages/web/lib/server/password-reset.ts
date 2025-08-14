// ABOUTME: Password reset functionality for CLI
// ABOUTME: Generates new passwords, updates auth config, and displays them securely

import * as crypto from 'crypto';
import { generatePassword, hashPassword, loadAuthConfig, saveAuthConfig } from '@/lib/server/auth-config';

/**
 * Reset the authentication password
 * Generates a new secure password, updates the auth config, and displays it to the user
 */
export async function resetPassword(): Promise<void> {
  try {
    // eslint-disable-next-line no-console
    console.log('🔐 Password Reset Complete');
    // eslint-disable-next-line no-console
    console.log('');
    
    // Generate new password
    const newPassword = generatePassword();
    
    // Hash the password
    const { hash, salt } = await hashPassword(newPassword);
    
    // Load existing config to preserve other properties
    const existingConfig = await loadAuthConfig();
    
    // Create new config with updated password
    const newConfig = {
      ...existingConfig,
      passwordHash: hash,
      salt: salt,
      iterations: existingConfig?.iterations ?? 16384,
      createdAt: existingConfig?.createdAt ?? new Date().toISOString(),
      algorithm: existingConfig?.algorithm ?? 'scrypt' as const,
      jwtSecret: existingConfig?.jwtSecret ?? crypto.randomBytes(32).toString('hex')
    };
    
    // Save the updated config
    await saveAuthConfig(newConfig);
    
    // Display the new password
    // eslint-disable-next-line no-console
    console.log('   New password: ' + newPassword);
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('   ⚠️  Security Notice:');
    // eslint-disable-next-line no-console
    console.log('   This password will be displayed only once.');
    // eslint-disable-next-line no-console
    console.log('   Please save it in a secure location immediately.');
    // eslint-disable-next-line no-console
    console.log('');
    // eslint-disable-next-line no-console
    console.log('   You can now use this password to log in to the web interface.');
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new Error(`Failed to reset password: ${message}`);
  }
}
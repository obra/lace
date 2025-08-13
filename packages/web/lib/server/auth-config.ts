// ABOUTME: Authentication configuration and password management
// ABOUTME: Handles secure password generation, hashing, JWT secret management, and auth.json storage

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getLaceFilePath } from '~/config/lace-dir';

const ITERATIONS = 16384;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export interface AuthConfig {
  passwordHash: string;
  salt: string;
  iterations: number;
  createdAt: string;
  algorithm: 'scrypt';
  jwtSecret: string;
}

/**
 * Generate a secure random password
 */
export function generatePassword(): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const length = 24;
  const bytes = crypto.randomBytes(length);
  
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[bytes[i] % charset.length];
  }
  
  return result;
}

/**
 * Hash a password using scrypt
 */
export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
    
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      
      resolve({
        hash: derivedKey.toString('hex'),
        salt
      });
    });
  });
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      
      resolve(derivedKey.toString('hex') === hash);
    });
  });
}

/**
 * Load auth configuration from auth.json
 */
export function loadAuthConfig(): AuthConfig | null {
  const authPath = getLaceFilePath('auth.json');
  
  if (!fs.existsSync(authPath)) {
    return null;
  }
  
  try {
    const data = fs.readFileSync(authPath, 'utf-8');
    return JSON.parse(data) as AuthConfig;
  } catch (error) {
    throw new Error(`Failed to load auth config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Save auth configuration to auth.json with secure permissions
 */
export function saveAuthConfig(config: AuthConfig): void {
  const authPath = getLaceFilePath('auth.json');
  const authDir = path.dirname(authPath);
  
  // Ensure directory exists
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }
  
  // Write file with restrictive permissions (0600)
  fs.writeFileSync(authPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/**
 * Initialize authentication - generate password and save config
 */
export async function initializeAuth(): Promise<string> {
  const password = generatePassword();
  const { hash, salt } = await hashPassword(password);
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  
  const config: AuthConfig = {
    passwordHash: hash,
    salt,
    iterations: ITERATIONS,
    createdAt: new Date().toISOString(),
    algorithm: 'scrypt',
    jwtSecret
  };
  
  saveAuthConfig(config);
  return password;
}

/**
 * Reset password - generate new password and update config
 */
export async function resetPassword(): Promise<string> {
  const existingConfig = loadAuthConfig();
  const password = generatePassword();
  const { hash, salt } = await hashPassword(password);
  
  const config: AuthConfig = {
    passwordHash: hash,
    salt,
    iterations: ITERATIONS,
    createdAt: new Date().toISOString(),
    algorithm: 'scrypt',
    jwtSecret: existingConfig?.jwtSecret || crypto.randomBytes(32).toString('hex')
  };
  
  saveAuthConfig(config);
  return password;
}

/**
 * Get existing auth config or initialize if none exists
 */
export async function getOrInitializeAuth(): Promise<{ config: AuthConfig; password?: string }> {
  const existingConfig = loadAuthConfig();
  
  if (existingConfig) {
    return { config: existingConfig };
  }
  
  const password = await initializeAuth();
  const config = loadAuthConfig()!;
  
  return { config, password };
}

let _cachedJwtSecret: string | null = null;

/**
 * Get or generate JWT secret
 */
export function getOrGenerateJWTSecret(): string {
  if (_cachedJwtSecret) {
    return _cachedJwtSecret;
  }
  
  const config = loadAuthConfig();
  
  if (config?.jwtSecret) {
    _cachedJwtSecret = config.jwtSecret;
    return config.jwtSecret;
  }
  
  // Generate new JWT secret and save it
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  
  if (config) {
    // Update existing config
    config.jwtSecret = jwtSecret;
    saveAuthConfig(config);
  } else {
    // Create minimal config just for JWT secret
    const minimalConfig: AuthConfig = {
      passwordHash: '',
      salt: '',
      iterations: ITERATIONS,
      createdAt: new Date().toISOString(),
      algorithm: 'scrypt',
      jwtSecret
    };
    saveAuthConfig(minimalConfig);
  }
  
  _cachedJwtSecret = jwtSecret;
  return jwtSecret;
}

/**
 * Clear the JWT secret cache - primarily for testing
 */
export function clearJWTSecretCache(): void {
  _cachedJwtSecret = null;
}
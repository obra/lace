// ABOUTME: JWT token generation and validation service
// ABOUTME: Handles JWT creation, verification, and one-time token management

import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { getOrGenerateJWTSecret } from '@/lib/server/auth-config';

export interface TokenPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

const DEFAULT_EXPIRY = '24h';
const ONE_TIME_TOKEN_EXPIRY = 30000; // 30 seconds in milliseconds

// In-memory storage for one-time tokens
const oneTimeTokens = new Map<string, { expiry: number }>();

/**
 * Generate a JWT token
 */
export function generateJWT(payload: TokenPayload, expiry: string = DEFAULT_EXPIRY): string {
  const secret = getOrGenerateJWTSecret();
  
  return jwt.sign(payload, secret as string, {
    expiresIn: expiry,
    algorithm: 'HS256'
  } as jwt.SignOptions);
}

/**
 * Verify and decode a JWT token
 */
export function verifyJWT(token: string): TokenPayload | null {
  try {
    const secret = getOrGenerateJWTSecret();
    const decoded = jwt.verify(token, secret as string, { algorithms: ['HS256'] } as jwt.VerifyOptions) as TokenPayload;
    return decoded;
  } catch (_error) {
    return null;
  }
}

/**
 * Generate a one-time token for auto-login
 */
export function generateOneTimeToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + ONE_TIME_TOKEN_EXPIRY;
  
  oneTimeTokens.set(token, { expiry });
  
  // Clean up expired tokens periodically
  cleanupExpiredTokens();
  
  return token;
}

/**
 * Consume a one-time token and return a JWT
 */
export function consumeOneTimeToken(token: string): string | null {
  const tokenData = oneTimeTokens.get(token);
  
  if (!tokenData) {
    return null;
  }
  
  // Check if token has expired
  if (Date.now() > tokenData.expiry) {
    oneTimeTokens.delete(token);
    return null;
  }
  
  // Remove token after use (one-time only)
  oneTimeTokens.delete(token);
  
  // Generate JWT for the user
  return generateJWT({ userId: 'console-user' });
}

/**
 * Clean up expired one-time tokens
 */
function cleanupExpiredTokens(): void {
  const now = Date.now();
  
  for (const [token, data] of oneTimeTokens.entries()) {
    if (now > data.expiry) {
      oneTimeTokens.delete(token);
    }
  }
}

/**
 * Invalidate all sessions by regenerating the JWT secret
 * This will make all existing JWT tokens invalid
 */
export async function invalidateAllSessions(): Promise<void> {
  const { loadAuthConfig, saveAuthConfig, clearJWTSecretCache } = await import('./auth-config');
  
  // Generate new JWT secret
  const newJWTSecret = crypto.randomBytes(32).toString('hex');
  
  // Load existing config
  const config = await loadAuthConfig();
  if (!config) {
    throw new Error('No authentication configuration found');
  }
  
  // Update config with new JWT secret
  const updatedConfig = {
    ...config,
    jwtSecret: newJWTSecret,
  };
  
  // Save updated config
  await saveAuthConfig(updatedConfig);
  
  // Clear cached secret so new one gets loaded
  clearJWTSecretCache();
  
  // Clear one-time tokens
  oneTimeTokens.clear();
}
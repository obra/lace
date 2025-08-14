// ABOUTME: Authentication service integrating password verification and JWT management
// ABOUTME: Provides high-level auth operations combining auth-config and auth-tokens modules

import { NextRequest } from 'next/server';
import { loadAuthConfig, verifyPassword } from '@/lib/server/auth-config';
import { generateJWT, verifyJWT, generateOneTimeToken, consumeOneTimeToken } from '@/lib/server/auth-tokens';

export interface LoginSuccess {
  success: true;
  jwt: string;
}

export interface LoginFailure {
  success: false;
  error: string;
}

export type LoginResult = LoginSuccess | LoginFailure;

/**
 * Authenticate user with password and return JWT
 */
export async function login(password: string, expiry?: string): Promise<LoginResult> {
  const config = loadAuthConfig();
  
  if (!config) {
    return {
      success: false,
      error: 'Authentication not configured'
    };
  }
  
  try {
    const isValid = await verifyPassword(password, config.passwordHash, config.salt);
    
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid password'
      };
    }
    
    const jwt = generateJWT({ userId: 'console-user' }, expiry);
    
    return {
      success: true,
      jwt
    };
  } catch (_error) {
    return {
      success: false,
      error: 'Authentication failed'
    };
  }
}

/**
 * Check if a request is authenticated via JWT cookie or Authorization header
 */
export function isAuthenticated(request: NextRequest): boolean {
  // Try to get JWT from cookie first
  let token = request.cookies.get('auth-token')?.value;
  
  // If not in cookie, try Authorization header
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  
  if (!token) {
    return false;
  }
  
  // Verify the JWT
  const payload = verifyJWT(token);
  return payload !== null;
}

/**
 * Generate a one-time login URL for auto-login from console
 */
export function generateOneTimeLoginURL(baseUrl: string): string {
  const token = generateOneTimeToken();
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

/**
 * Exchange a one-time token for a JWT
 */
export function exchangeOneTimeToken(token: string): string | null {
  return consumeOneTimeToken(token);
}
// ABOUTME: Authentication utilities for API routes
// ABOUTME: Provides JWT extraction, validation, and error response helpers for API endpoints

import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT } from '@/lib/server/auth-tokens';

/**
 * Extract JWT token from request (cookie or Authorization header)
 */
export function extractTokenFromRequest(request: NextRequest): string | null {
  // Try to get JWT from cookie first (NextRequest has cookies property)
  let token: string | undefined;
  
  // Handle case where cookies might not be available (e.g., in tests)
  try {
    token = request.cookies?.get('auth-token')?.value;
  } catch {
    // Fallback: parse cookies from Cookie header
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
        const [name, value] = cookie.trim().split('=');
        if (name === 'auth-token') {
          acc = value;
        }
        return acc;
      }, undefined as string | undefined);
      token = cookies;
    }
  }
  
  // If not in cookie, try Authorization header
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
      // Check if token is not empty
      if (!token.trim()) {
        token = undefined;
      }
    }
  }
  
  return token || null;
}

/**
 * Create standardized authentication error responses
 */
export function createAuthErrorResponse(type: 'missing' | 'invalid' | 'error'): NextResponse {
  switch (type) {
    case 'missing':
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    case 'invalid':
      return NextResponse.json(
        { error: 'Invalid authentication token' },
        { status: 401 }
      );
    case 'error':
      return NextResponse.json(
        { error: 'Authentication check failed' },
        { status: 500 }
      );
  }
}

/**
 * Require authentication for API route
 * Returns null if authenticated, or error response if not
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  try {
    // Extract token from request
    const token = extractTokenFromRequest(request);
    
    if (!token) {
      return createAuthErrorResponse('missing');
    }
    
    // Verify token directly using JWT verification
    const payload = verifyJWT(token);
    
    if (!payload) {
      return createAuthErrorResponse('invalid');
    }
    
    // Authentication successful
    return null;
    
  } catch (_error) {
    console.error('API authentication error:', _error);
    return createAuthErrorResponse('error');
  }
}
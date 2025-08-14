// ABOUTME: Next.js authentication middleware for route protection
// ABOUTME: Runs on Edge Runtime, uses jose library for JWT verification

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Get JWT secret for Edge Runtime
 * Must be provided via environment variable since Edge Runtime cannot access filesystem
 */
function getJWTSecret(): Uint8Array {
  const secret = process.env.LACE_JWT_SECRET || 'fallback-dev-secret';
  return new TextEncoder().encode(secret);
}

/**
 * Extract JWT token from request (cookie or Authorization header)
 */
function extractToken(request: NextRequest): string | null {
  // Try to get JWT from cookie first
  let token = request.cookies.get('auth-token')?.value;
  
  // If not in cookie, try Authorization header
  if (!token) {
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  
  return token || null;
}

/**
 * Check if request should bypass authentication
 */
function shouldBypass(request: NextRequest): boolean {
  const url = request.nextUrl.clone();
  
  // Allow auth-related routes
  if (url.pathname.startsWith('/api/auth/')) {
    return true;
  }
  
  // Allow login page
  if (url.pathname === '/login') {
    return true;
  }
  
  // Allow root path (client-side routing will handle auth)
  if (url.pathname === '/') {
    return true;
  }
  
  // Allow localhost bypass if configured
  if (process.env.LACE_ALLOW_LOCALHOST === 'true' && url.hostname === 'localhost') {
    return true;
  }
  
  return false;
}

/**
 * Verify JWT token using jose library (Edge Runtime compatible)
 */
async function verifyToken(token: string): Promise<boolean> {
  try {
    const secret = getJWTSecret();
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

/**
 * Next.js middleware function
 */
export async function middleware(request: NextRequest): Promise<NextResponse | undefined> {
  // Check if request should bypass authentication
  if (shouldBypass(request)) {
    return undefined; // Continue to next middleware or route handler
  }
  
  // Extract JWT token from request
  const token = extractToken(request);
  
  if (!token) {
    // No token found, redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // Verify the JWT token
  const isValid = await verifyToken(token);
  
  if (!isValid) {
    // Invalid token, redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }
  
  // Token is valid, continue to route handler
  return undefined;
}

/**
 * Middleware configuration - specify which routes to run middleware on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/auth/* (auth endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - login (login page)
     * - public assets
     */
    '/api/((?!auth).*)',
    '/((?!_next/static|_next/image|favicon.ico|login|public).*)',
  ]
};
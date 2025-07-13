// ABOUTME: Next.js middleware for logging all API requests and responses
// ABOUTME: Provides comprehensive request/response logging for debugging

import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const requestId = Math.random().toString(36).substring(7);
  const startTime = Date.now();
  
  // Log incoming request to stdout (Edge Runtime compatible)
  console.log(`[MIDDLEWARE] ${new Date().toISOString()} API Request`, {
    requestId,
    method: request.method,
    url: request.url,
    pathname: request.nextUrl.pathname,
    userAgent: request.headers.get('user-agent'),
    contentType: request.headers.get('content-type'),
  });

  // Continue to the route handler
  const response = NextResponse.next();

  // Add request ID to response headers for tracing
  response.headers.set('X-Request-ID', requestId);

  // Log response (this might not capture all details for streaming responses)
  const endTime = Date.now();
  console.log(`[MIDDLEWARE] ${new Date().toISOString()} API Response`, {
    requestId,
    status: response.status,
    duration: `${endTime - startTime}ms`,
    pathname: request.nextUrl.pathname,
  });

  return response;
}

// Configure which routes this middleware runs on
export const config = {
  matcher: [
    // Run on all API routes
    '/api/:path*',
    // Exclude static files and internal Next.js routes
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
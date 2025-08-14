// ABOUTME: Authentication status API route
// ABOUTME: Checks JWT token validity and returns authentication status

import { NextRequest, NextResponse } from 'next/server';
import { extractTokenFromRequest } from '@/lib/server/api-auth';
import { verifyJWT } from '@/lib/server/auth-tokens';

export function GET(request: NextRequest): NextResponse {
  try {
    // Extract JWT token from request
    const token = extractTokenFromRequest(request);
    
    if (!token) {
      return NextResponse.json({
        authenticated: false,
      });
    }
    
    // Check if token is valid
    const payload = verifyJWT(token);
    const authenticated = payload !== null;
    
    return NextResponse.json({
      authenticated,
    });

  } catch (_error) {
    console.error('Auth status API error:', _error);
    return NextResponse.json(
      { error: 'Authentication check failed' },
      { status: 500 }
    );
  }
}
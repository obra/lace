// ABOUTME: Logout all sessions API route for invalidating all user sessions
// ABOUTME: Regenerates JWT secret to invalidate all existing tokens

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/api-auth';
import { invalidateAllSessions } from '@/lib/server/auth-tokens';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check authentication
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    // Invalidate all sessions by regenerating JWT secret
    await invalidateAllSessions();

    return NextResponse.json({
      success: true,
      message: 'All sessions terminated successfully',
    });

  } catch (error) {
    console.error('Logout all API error:', error);
    return NextResponse.json(
      { error: 'Failed to terminate sessions' },
      { status: 500 }
    );
  }
}
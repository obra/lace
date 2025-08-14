// ABOUTME: Logout API route for clearing authentication
// ABOUTME: Removes auth cookies and invalidates user session

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function POST(_request: NextRequest): Promise<NextResponse> {
  try {
    // Delete the auth cookie
    const cookieStore = await cookies();
    cookieStore.delete('auth-token');

    return NextResponse.json({
      success: true,
      message: 'Logged out successfully',
    });

  } catch (_error) {
    console.error('Logout API error:', _error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}
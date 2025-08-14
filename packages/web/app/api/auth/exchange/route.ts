// ABOUTME: One-time token exchange API route
// ABOUTME: Exchanges one-time tokens for JWT tokens and sets secure cookies

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { consumeOneTimeToken } from '@/lib/server/auth-tokens';

interface ExchangeRequest {
  token: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse request body
    let body: ExchangeRequest;
    try {
      body = await request.json() as ExchangeRequest;
    } catch {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.token || typeof body.token !== 'string' || !body.token.trim()) {
      return NextResponse.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Attempt to consume the one-time token
    const jwt = consumeOneTimeToken(body.token);

    if (!jwt) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Set secure HTTP-only cookie with 1 hour expiry
    const cookieStore = await cookies();
    cookieStore.set('auth-token', jwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60, // 1 hour in seconds
    });

    // Return success response
    return NextResponse.json({
      success: true,
      jwt,
    });

  } catch (_error) {
    console.error('Token exchange API error:', _error);
    return NextResponse.json(
      { error: 'Token exchange failed' },
      { status: 500 }
    );
  }
}
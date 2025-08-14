// ABOUTME: Login API route for password authentication
// ABOUTME: Validates credentials, generates JWT tokens, and sets secure cookies

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { login } from '@/lib/server/auth-service';

interface LoginRequest {
  password: string;
  rememberMe?: boolean;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse request body
    let body: LoginRequest;
    try {
      body = await request.json() as LoginRequest;
    } catch {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.password || typeof body.password !== 'string' || !body.password.trim()) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      );
    }

    // Attempt authentication
    const result = await login(body.password);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Authentication failed' },
        { status: 401 }
      );
    }

    // Set secure HTTP-only cookie
    const cookieStore = await cookies();
    const rememberMe = body.rememberMe === true;
    const maxAge = rememberMe 
      ? 30 * 24 * 60 * 60 // 30 days in seconds
      : 60 * 60; // 1 hour in seconds

    cookieStore.set('auth-token', result.jwt!, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge,
    });

    // Return success response
    return NextResponse.json({
      success: true,
      jwt: result.jwt,
    });

  } catch (_error) {
    // Log error but don't expose internal details
    console.error('Login API error:', _error);
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}
// ABOUTME: Session management API endpoints for creating and listing sessions
// ABOUTME: Sessions are parent threads that contain multiple agent threads

import { NextRequest, NextResponse } from 'next/server';
import { getSessionService } from '@/lib/server/session-service';
import { ApiErrorResponse } from '@/types/api';
import { CreateSessionRequestSchema } from '@/lib/validation/schemas';
import { sessionCreationLimiter } from '@/lib/middleware/rate-limiter';

// Type guard for unknown error values
function isError(error: unknown): error is Error {
  return error instanceof Error;
}

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const sessionService = getSessionService();
    const sessions = await sessionService.listSessions();

    return NextResponse.json({ sessions });
  } catch (error: unknown) {
    console.error('Error in GET /api/sessions:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Apply rate limiting
  const rateLimitResponse = sessionCreationLimiter(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const sessionService = getSessionService();

    // Parse and validate request body
    const bodyRaw: unknown = await request.json();
    const bodyResult = CreateSessionRequestSchema.safeParse(bodyRaw);

    if (!bodyResult.success) {
      const errorResponse: ApiErrorResponse = {
        error: bodyResult.error.errors[0]?.message || 'Invalid request body',
      };
      return NextResponse.json(errorResponse, { status: 400 });
    }

    const body = bodyResult.data;
    const session = await sessionService.createSession(body.name, body.provider, body.model);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error: unknown) {
    console.error('Error in POST /api/sessions:', error);

    const errorMessage = isError(error) ? error.message : 'Internal server error';
    const errorResponse: ApiErrorResponse = { error: errorMessage };
    return NextResponse.json(errorResponse, { status: 500 });
  }
}

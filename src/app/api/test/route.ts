import { NextRequest, NextResponse } from 'next/server';

interface RequestBody {
  message: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;
    return NextResponse.json({
      message: `Hello! You said: ${body.message}`,
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 });
  }
}

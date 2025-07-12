// ABOUTME: API route for chat functionality
// ABOUTME: Connects React frontend to shared Agent instance

// API route for Next.js - types will be available at runtime
// import { NextRequest, NextResponse } from 'next/server';

// TODO: Need to get access to the shared Agent instance from WebInterface
// For now, return a placeholder response

export async function POST(request: Request) {
  try {
    const { message } = await request.json() as { message?: string };

    if (!message) {
      return Response.json({ error: 'Message is required' }, { status: 400 });
    }

    // TODO: Send message to shared Agent instance
    // For now, return an echo response
    const response = {
      message: `Echo: ${message} (TODO: Connect to Agent)`,
      timestamp: new Date().toISOString(),
    };

    return Response.json(response);
  } catch (error) {
    console.error('Error in chat API:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export function GET() {
  return Response.json({
    status: 'Chat API is running',
    timestamp: new Date().toISOString(),
  });
}
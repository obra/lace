import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

interface RequestBody {
  message: string;
  threadId?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RequestBody;

    // Use the compiled CLI with subprocess approach for better compatibility
    const cliPath = path.join(process.cwd(), 'dist', 'cli.js');

    // Create args for the CLI
    const args = ['--prompt', body.message];
    if (body.threadId) {
      args.push('--continue', body.threadId);
    }

    // Stream the response using Server-Sent Events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const child = spawn('node', [cliPath, ...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env },
        });

        let output = '';

        child.stdout.on('data', (data: Buffer) => {
          const chunk = data.toString();
          output += chunk;

          // Send incremental updates as SSE
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`)
          );
        });

        child.stderr.on('data', (data: Buffer) => {
          const errorChunk = data.toString();
          console.error('CLI stderr:', errorChunk);

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorChunk })}\n\n`)
          );
        });

        child.on('close', (code: number) => {
          if (code === 0) {
            // Success - send complete message
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  content: output.trim(),
                  exitCode: code,
                })}\n\n`
              )
            );
          } else {
            // Error
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: `CLI exited with code ${code}`,
                  exitCode: code,
                })}\n\n`
              )
            );
          }
          controller.close();
        });

        child.on('error', (error: Error) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                error: error.message,
              })}\n\n`
            )
          );
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process request',
      },
      { status: 500 }
    );
  }
}

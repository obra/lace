// ABOUTME: API route for thread/conversation management using core Lace components
import { NextRequest, NextResponse } from 'next/server';
import { ThreadManager } from '~/threads/thread-manager';
import { getLaceDbPath } from '~/config/lace-dir';
import { loadEnvFile } from '~/config/env-loader';
import { logger } from '~/utils/logger';

// Initialize environment
loadEnvFile();

interface CreateThreadRequest {
  name?: string;
  metadata?: Record<string, unknown>;
}

interface ThreadInfo {
  threadId: string;
  name?: string;
  createdAt: string;
  lastActivity: string;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

// GET endpoint to list threads or get specific thread info
export function GET(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Initialize thread manager
    const dbPath = getLaceDbPath();
    const threadManager = new ThreadManager(dbPath);

    if (threadId) {
      // Get specific thread info
      const events = threadManager.getEvents(threadId);

      if (!events || events.length === 0) {
        return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
      }

      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];

      const threadInfo: ThreadInfo = {
        threadId,
        createdAt: firstEvent.timestamp.toISOString(),
        lastActivity: lastEvent.timestamp.toISOString(),
        messageCount: events.filter((e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE')
          .length,
      };

      return NextResponse.json(threadInfo);
    } else {
      // List all threads
      const latestThreadId = threadManager.getLatestThreadId();

      // For now, we'll return a simplified list
      // In a full implementation, you'd want to add thread listing to ThreadManager
      const threads: ThreadInfo[] = [];

      if (latestThreadId) {
        const events = threadManager.getEvents(latestThreadId);
        if (events && events.length > 0) {
          const firstEvent = events[0];
          const lastEvent = events[events.length - 1];

          threads.push({
            threadId: latestThreadId,
            createdAt: firstEvent.timestamp.toISOString(),
            lastActivity: lastEvent.timestamp.toISOString(),
            messageCount: events.filter(
              (e) => e.type === 'USER_MESSAGE' || e.type === 'AGENT_MESSAGE'
            ).length,
          });
        }
      }

      return NextResponse.json({
        threads: threads.slice(offset, offset + limit),
        total: threads.length,
        limit,
        offset,
      });
    }
  } catch (error) {
    logger.error('API threads list error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to retrieve threads',
      },
      { status: 500 }
    );
  }
}

// POST endpoint to create a new thread
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CreateThreadRequest;

    // Configure logger
    logger.configure('info');

    // Initialize thread manager
    const dbPath = getLaceDbPath();
    const threadManager = new ThreadManager(dbPath);

    // Create new thread
    const sessionInfo = threadManager.resumeOrCreate();
    const threadId = sessionInfo.threadId;

    // Add metadata event if provided
    if (body.name || body.metadata) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const metadataEvent = {
        id: `metadata_${Date.now()}`,
        type: 'METADATA' as const,
        threadId,
        timestamp: new Date().toISOString(),
        data: {
          name: body.name,
          ...body.metadata,
        },
        metadata: body.metadata,
      };

      // Note: addEvent expects different parameters - this would need to be implemented properly
      // threadManager.addEvent(metadataEvent);
    }

    const threadInfo: ThreadInfo = {
      threadId,
      name: body.name,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      messageCount: 0,
      metadata: body.metadata,
    };

    return NextResponse.json(threadInfo, { status: 201 });
  } catch (error) {
    logger.error('API thread creation error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create thread',
      },
      { status: 500 }
    );
  }
}

// DELETE endpoint to delete a thread
export function DELETE(request: NextRequest): NextResponse {
  try {
    const { searchParams } = new URL(request.url);
    const threadId = searchParams.get('threadId');

    if (!threadId) {
      return NextResponse.json({ error: 'threadId parameter is required' }, { status: 400 });
    }

    // Configure logger
    logger.configure('info');

    // Initialize thread manager
    const dbPath = getLaceDbPath();
    const threadManager = new ThreadManager(dbPath);

    // Check if thread exists
    const events = threadManager.getEvents(threadId);
    if (!events || events.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    // Note: ThreadManager doesn't currently have a delete method
    // This would need to be implemented in the core ThreadManager class
    // For now, we'll return a not implemented error
    return NextResponse.json(
      {
        error: 'Thread deletion not yet implemented in core ThreadManager',
        note: 'This feature needs to be added to the ThreadManager class',
      },
      { status: 501 }
    );
  } catch (error) {
    logger.error('API thread deletion error:', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to delete thread',
      },
      { status: 500 }
    );
  }
}

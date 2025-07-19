// ABOUTME: Unit tests for task notes API endpoints
// ABOUTME: Tests adding notes to tasks

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unused-vars */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/tasks/[taskId]/notes/route';
import type { SessionService } from '@/lib/server/session-service';
import type { Session } from '@/types/api';
import type { Session as CoreSession } from '@/lib/server/core-types';
import {
  setupTestPersistence,
  teardownTestPersistence,
} from '~/__tests__/setup/persistence-helper';

// Helper function for tests to avoid server-only imports
function createThreadId(id: string) {
  return id as import('@/types/api').ThreadId;
}

// Create mock TaskManager
const mockTaskManager = {
  createTask: vi.fn(),
  getTasks: vi.fn(),
  getTaskById: vi.fn(),
  updateTask: vi.fn(),
  addNote: vi.fn(),
  deleteTask: vi.fn(),
  getTaskSummary: vi.fn(),
  listTasks: vi.fn(),
  getTask: vi.fn(),
};

// Create a mock Session instance
const mockSession: Partial<Session> = {
  getId: vi.fn().mockReturnValue(createThreadId('lace_20240101_session')),
  getInfo: vi.fn().mockReturnValue({
    id: createThreadId('lace_20240101_session'),
    name: 'Test Session',
    createdAt: '2024-01-01T00:00:00Z',
    agents: [],
  }),
  getAgents: vi.fn().mockReturnValue([]),
  getTaskManager: vi.fn().mockReturnValue(mockTaskManager),
};

// Create the properly typed mock service
const mockSessionService = {
  createSession: vi.fn<SessionService['createSession']>(),
  listSessions: vi.fn<SessionService['listSessions']>(),
  getSession: vi
    .fn<SessionService['getSession']>()
    .mockResolvedValue(mockSession as unknown as CoreSession),
  spawnAgent: vi.fn<SessionService['spawnAgent']>(),
  getAgent: vi.fn<SessionService['getAgent']>(),
};

// Mock the session service
vi.mock('@/lib/server/session-service', () => ({
  getSessionService: () => mockSessionService,
}));

describe('Task Notes API Routes', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setupTestPersistence();
    vi.clearAllMocks();

    // Mock console methods to prevent stderr pollution during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    teardownTestPersistence();
  });

  describe('POST /api/tasks/[taskId]/notes', () => {
    it('should return 400 if sessionId is missing', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123/notes',
        {
          method: 'POST',
          body: JSON.stringify({ content: 'Test note' }),
        }
      );

      const response = await POST(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Session ID is required');
    });

    it('should return 400 if content is missing', async () => {
      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123/notes',
        {
          method: 'POST',
          body: JSON.stringify({ sessionId: 'lace_20240101_session' }),
        }
      );

      const response = await POST(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Note content is required');
    });

    it('should add note to task', async () => {
      mockTaskManager.addNote.mockResolvedValue(undefined);

      // Mock getTaskById to return updated task with note
      mockTaskManager.getTaskById.mockReturnValue({
        id: 'task_20240101_abc123',
        title: 'Test Task',
        description: 'Test Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T02:00:00Z'),
        notes: [
          {
            id: 'note_20240101_new',
            author: createThreadId('human'),
            content: 'This is a new note',
            timestamp: new Date('2024-01-01T02:00:00Z'),
          },
        ],
      });

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123/notes',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'lace_20240101_session',
            content: 'This is a new note',
          }),
        }
      );

      const response = await POST(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.message).toBe('Note added successfully');
      expect(data.task.notes).toHaveLength(1);
      expect(data.task.notes[0].content).toBe('This is a new note');
      expect(mockTaskManager.addNote).toHaveBeenCalledWith(
        'task_20240101_abc123',
        'This is a new note',
        { actor: 'human', isHuman: true }
      );
    });

    it('should handle errors when adding note', async () => {
      mockTaskManager.addNote.mockRejectedValue(new Error('Task not found'));

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_notfound/notes',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'lace_20240101_session',
            content: 'This is a note',
          }),
        }
      );

      const response = await POST(request, { params: { taskId: 'task_20240101_notfound' } });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Task not found');
    });

    it('should add note from agent', async () => {
      mockTaskManager.addNote.mockResolvedValue(undefined);

      // Mock getTaskById to return updated task with note
      mockTaskManager.getTaskById.mockReturnValue({
        id: 'task_20240101_abc123',
        title: 'Test Task',
        description: 'Test Description',
        prompt: 'Test Prompt',
        status: 'in_progress',
        priority: 'high',
        createdBy: createThreadId('lace_20240101_creator'),
        threadId: createThreadId('lace_20240101_session'),
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T02:00:00Z'),
        notes: [
          {
            id: 'note_20240101_new',
            author: createThreadId('lace_20240101_agent1'),
            content: 'Agent progress update',
            timestamp: new Date('2024-01-01T02:00:00Z'),
          },
        ],
      });

      const request = new NextRequest(
        'http://localhost:3000/api/tasks/task_20240101_abc123/notes',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: 'lace_20240101_session',
            content: 'Agent progress update',
            author: 'lace_20240101_agent1',
          }),
        }
      );

      const response = await POST(request, { params: { taskId: 'task_20240101_abc123' } });
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(mockTaskManager.addNote).toHaveBeenCalledWith(
        'task_20240101_abc123',
        'Agent progress update',
        { actor: 'lace_20240101_agent1', isHuman: false }
      );
    });
  });
});

// ABOUTME: Tests for Session class
// ABOUTME: Verifies session creation, agent spawning, and session management

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Agent } from '~/agents/agent';
import { asThreadId, type ThreadId } from '~/threads/types';

// Mock Agent
vi.mock('~/agents/agent', () => ({
  Agent: vi.fn(() => ({
    threadId: asThreadId('mock-thread-id'),
    stop: vi.fn(),
    sendMessage: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  })),
}));

// Mock getLaceDbPath
vi.mock('~/config/lace-dir', () => ({
  getLaceDbPath: vi.fn().mockReturnValue('/test/db/path'),
}));

// Mock ProviderRegistry
vi.mock('~/providers/registry', () => ({
  ProviderRegistry: {
    createWithAutoDiscovery: vi.fn().mockReturnValue({
      createProvider: vi.fn().mockReturnValue({
        type: 'openai',
        model: 'gpt-4',
      }),
    }),
  },
}));

// Mock ThreadManager
vi.mock('~/threads/thread-manager', () => ({
  ThreadManager: vi.fn(() => ({
    resumeOrCreate: vi.fn().mockReturnValue({
      threadId: 'test-thread-id',
      isNew: true,
    }),
    getAllThreadsWithMetadata: vi.fn().mockReturnValue([]),
    getThread: vi.fn().mockReturnValue(null),
  })),
}));

// Mock DatabasePersistence
vi.mock('~/persistence/database', () => ({
  DatabasePersistence: vi.fn(() => ({
    // Mock any needed methods
  })),
}));

// Mock ToolExecutor
vi.mock('~/tools/executor', () => ({
  ToolExecutor: vi.fn(() => ({
    registerTools: vi.fn(),
    getAllTools: vi.fn().mockReturnValue([]),
  })),
}));

// Mock TaskManager
vi.mock('~/tasks/task-manager', () => ({
  TaskManager: vi.fn(() => ({
    // Mock any needed methods
  })),
}));

// Mock tool implementations
vi.mock('~/tools/implementations/task-manager', () => ({
  createTaskManagerTools: vi.fn(() => []),
}));

describe('Session', () => {
  let mockAgent: {
    threadId: ThreadId;
    providerName: string;
    getCurrentState: ReturnType<typeof vi.fn>;
    toolExecutor: { mock: string };
    updateThreadMetadata: ReturnType<typeof vi.fn>;
    getThreadMetadata: ReturnType<typeof vi.fn>;
    createDelegateAgent: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    emit: ReturnType<typeof vi.fn>;
  };
  let mockDelegateAgents: Array<{
    threadId: ThreadId;
    providerName: string;
    getCurrentState: ReturnType<typeof vi.fn>;
    toolExecutor: { mock: string };
    updateThreadMetadata: ReturnType<typeof vi.fn>;
    getThreadMetadata: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  }>;
  let delegateAgentCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    delegateAgentCounter = 0;
    mockDelegateAgents = [];

    // Mock main session agent
    mockAgent = {
      threadId: asThreadId('test-session'),
      providerName: 'anthropic',
      getCurrentState: vi.fn().mockReturnValue('idle'),
      toolExecutor: { mock: 'toolExecutor' },
      updateThreadMetadata: vi.fn(),
      getThreadMetadata: vi.fn().mockReturnValue({
        name: 'Test Session',
        model: 'claude-3-haiku-20240307',
        provider: 'anthropic',
        isSession: true,
      }),
      createDelegateAgent: vi.fn().mockImplementation(() => {
        delegateAgentCounter++;
        const delegateAgent = {
          threadId: asThreadId(`test-session.${delegateAgentCounter}`),
          providerName: 'anthropic',
          getCurrentState: vi.fn().mockReturnValue('idle'),
          toolExecutor: { mock: 'toolExecutor' },
          updateThreadMetadata: vi.fn(),
          getThreadMetadata: vi.fn().mockReturnValue({
            name: `Agent test-session.${delegateAgentCounter}`,
            model: 'unknown',
            isAgent: true,
          }),
          start: vi.fn(),
          stop: vi.fn(),
          sendMessage: vi.fn(),
        };
        mockDelegateAgents.push(delegateAgent);
        return delegateAgent;
      }),
      start: vi.fn(),
      stop: vi.fn(),
      sendMessage: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    };

    // Set the mock to return our mock agent when instantiated
    (Agent as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);
  });

  describe('create', () => {
    it('should create a session with default parameters', () => {
      const session = Session.create('Test Session');

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.any(Object) as object,
          toolExecutor: expect.any(Object) as object,
          threadManager: expect.any(Object) as object,
          threadId: expect.any(String) as string,
          tools: expect.any(Array) as unknown[],
        })
      );

      expect(session).toBeInstanceOf(Session);
    });

    it('should create a session with custom parameters', () => {
      const session = Session.create('Custom Session', 'openai', 'gpt-4', '/custom/path');

      expect(Agent).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.any(Object) as object,
          toolExecutor: expect.any(Object) as object,
          threadManager: expect.any(Object) as object,
          threadId: expect.any(String) as string,
          tools: expect.any(Array) as unknown[],
        })
      );

      expect(session).toBeInstanceOf(Session);
    });
  });

  describe('getId', () => {
    it('should return the session thread ID', () => {
      const session = Session.create('Test Session');

      expect(session.getId()).toBe(asThreadId('test-session'));
    });
  });

  describe('getInfo', () => {
    it('should return session information', () => {
      const session = Session.create('Test Session');
      const info = session.getInfo();

      expect(info).toEqual({
        id: asThreadId('test-session'),
        name: 'Test Session',
        createdAt: expect.any(Date) as Date,
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        agents: [
          {
            threadId: asThreadId('test-session'),
            name: 'Test Session',
            provider: 'anthropic',
            model: 'claude-3-haiku-20240307',
            status: 'idle',
          },
        ],
      });
    });
  });

  describe('spawnAgent', () => {
    it('should spawn an agent using the session agent', () => {
      const session = Session.create('Test Session');

      const agent: ReturnType<typeof mockAgent.createDelegateAgent> =
        session.spawnAgent('Test Agent');

      expect(mockAgent.createDelegateAgent).toHaveBeenCalledWith(mockAgent.toolExecutor);
      expect(agent).toBe(mockDelegateAgents[0]);
    });

    it('should store the spawned agent', () => {
      const session = Session.create('Test Session');

      session.spawnAgent('Test Agent');

      const agents = session.getAgents();
      expect(agents).toHaveLength(2); // Coordinator + 1 spawned agent
      expect(agents[1]).toEqual({
        threadId: asThreadId('test-session.1'),
        name: 'Agent test-session.1',
        provider: 'anthropic',
        model: 'unknown',
        status: 'idle',
      });
    });
  });

  describe('getAgents', () => {
    it('should return coordinator agent when no agents spawned', () => {
      const session = Session.create('Test Session');

      const agents = session.getAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual({
        threadId: asThreadId('test-session'),
        name: 'Test Session',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        status: 'idle',
      });
    });

    it('should return spawned agents', () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Agent 1');
      session.spawnAgent('Agent 2');

      const agents = session.getAgents();

      expect(agents).toHaveLength(3); // Coordinator + 2 spawned agents
      expect(agents[0].threadId).toBe(asThreadId('test-session')); // Coordinator
      expect(agents[1].threadId).toBe(asThreadId('test-session.1'));
      expect(agents[2].threadId).toBe(asThreadId('test-session.2'));
    });
  });

  describe('getAgent', () => {
    it('should return null for non-existent agent', () => {
      const session = Session.create('Test Session');

      const agent = session.getAgent(asThreadId('non-existent'));

      expect(agent).toBeNull();
    });

    it('should return spawned agent', () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Test Agent');

      const agent = session.getAgent(asThreadId('test-session.1'));

      expect(agent).toBe(mockDelegateAgents[0]);
    });

    it('should return coordinator agent', () => {
      const session = Session.create('Test Session');

      const agent = session.getAgent(asThreadId('test-session'));

      expect(agent).toBe(mockAgent);
    });
  });

  describe('startAgent', () => {
    it('should start an agent', async () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Test Agent');

      await session.startAgent(asThreadId('test-session.1'));

      expect(mockDelegateAgents[0]?.start).toHaveBeenCalled();
    });

    it('should throw error for non-existent agent', async () => {
      const session = Session.create('Test Session');

      await expect(session.startAgent(asThreadId('non-existent'))).rejects.toThrow(
        'Agent not found: non-existent'
      );
    });
  });

  describe('stopAgent', () => {
    it('should stop an agent', () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Test Agent');

      session.stopAgent(asThreadId('test-session.1'));

      expect(mockDelegateAgents[0]?.stop).toHaveBeenCalled();
    });

    it('should throw error for non-existent agent', () => {
      const session = Session.create('Test Session');

      expect(() => session.stopAgent(asThreadId('non-existent'))).toThrow(
        'Agent not found: non-existent'
      );
    });
  });

  describe('sendMessage', () => {
    it('should send message to agent', async () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Test Agent');

      await session.sendMessage(asThreadId('test-session.1'), 'Hello');

      expect(mockDelegateAgents[0]?.sendMessage).toHaveBeenCalledWith('Hello');
    });

    it('should throw error for non-existent agent', async () => {
      const session = Session.create('Test Session');

      await expect(session.sendMessage(asThreadId('non-existent'), 'Hello')).rejects.toThrow(
        'Agent not found: non-existent'
      );
    });
  });

  describe('destroy', () => {
    it('should stop all agents and clear them', () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Agent 1');
      session.spawnAgent('Agent 2');

      session.destroy();

      expect(mockAgent.stop).toHaveBeenCalledTimes(1); // Coordinator
      expect(mockDelegateAgents[0]?.stop).toHaveBeenCalledTimes(1);
      expect(mockDelegateAgents[1]?.stop).toHaveBeenCalledTimes(1);
      expect(session.getAgents()).toHaveLength(1); // Only coordinator remains
    });
  });

  describe('static methods', () => {
    describe('getAll', () => {
      it('should return empty array (not implemented)', () => {
        const sessions = Session.getAll();

        expect(sessions).toEqual([]);
      });
    });

    describe('getById', () => {
      it('should return null for non-existent session', async () => {
        const session = await Session.getById(asThreadId('test-id'));

        expect(session).toBeNull();
      });
    });
  });
});

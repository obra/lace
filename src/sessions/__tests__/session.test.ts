// ABOUTME: Tests for Session class
// ABOUTME: Verifies session creation, agent spawning, and session management

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Session } from '~/sessions/session';
import { Agent } from '~/agents/agent';
import { asThreadId } from '~/threads/types';

// Mock Agent
vi.mock('~/agents/agent', () => ({
  Agent: {
    createSession: vi.fn(),
  },
}));

// Mock getLaceDbPath
vi.mock('~/config/lace-dir', () => ({
  getLaceDbPath: vi.fn().mockReturnValue('/test/db/path'),
}));

describe('Session', () => {
  let mockAgent: {
    threadId: string;
    providerName: string;
    getCurrentState: ReturnType<typeof vi.fn>;
    toolExecutor: { mock: string };
    updateThreadMetadata: ReturnType<typeof vi.fn>;
    getThreadMetadata: ReturnType<typeof vi.fn>;
    createDelegateAgent: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    sendMessage: ReturnType<typeof vi.fn>;
  };
  let mockDelegateAgents: Array<{
    threadId: string;
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
      threadId: 'test-session',
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
          threadId: `test-session.${delegateAgentCounter}`,
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
    };

    (Agent.createSession as ReturnType<typeof vi.fn>).mockReturnValue(mockAgent);
  });

  describe('create', () => {
    it('should create a session with default parameters', () => {
      const session = Session.create('Test Session');

      expect(Agent.createSession).toHaveBeenCalledWith({
        providerType: 'anthropic',
        model: 'claude-3-haiku-20240307',
        name: 'Test Session',
        dbPath: '/test/db/path',
      });

      expect(session).toBeInstanceOf(Session);
    });

    it('should create a session with custom parameters', () => {
      const session = Session.create('Custom Session', 'openai', 'gpt-4', '/custom/path');

      expect(Agent.createSession).toHaveBeenCalledWith({
        providerType: 'openai',
        model: 'gpt-4',
        name: 'Custom Session',
        dbPath: '/custom/path',
      });

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
        agents: [],
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
      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual({
        threadId: asThreadId('test-session.1'),
        name: 'Agent test-session.1',
        provider: 'anthropic',
        model: 'unknown',
        status: 'idle',
      });
    });
  });

  describe('getAgents', () => {
    it('should return empty array when no agents spawned', () => {
      const session = Session.create('Test Session');

      const agents = session.getAgents();

      expect(agents).toEqual([]);
    });

    it('should return spawned agents', () => {
      const session = Session.create('Test Session');
      session.spawnAgent('Agent 1');
      session.spawnAgent('Agent 2');

      const agents = session.getAgents();

      expect(agents).toHaveLength(2);
      expect(agents[0].threadId).toBe(asThreadId('test-session.1'));
      expect(agents[1].threadId).toBe(asThreadId('test-session.2'));
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

      expect(mockDelegateAgents[0]?.stop).toHaveBeenCalledTimes(1);
      expect(mockDelegateAgents[1]?.stop).toHaveBeenCalledTimes(1);
      expect(session.getAgents()).toEqual([]);
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

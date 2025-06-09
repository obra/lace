// ABOUTME: Tests for inter-agent message passing system enabling coordination without coordinator
// ABOUTME: Validates message routing, filtering, cleanup, and agent relationship tracking

import { jest } from '@jest/globals';
import { TaskTool } from '../../../src/tools/task-tool.js';

describe('Inter-Agent Communication', () => {
  let taskTool;
  let mockAgent;
  let mockProgressTracker;
  let mockSpawnedAgent;

  beforeEach(() => {
    // Mock progress tracker
    mockProgressTracker = {
      updateProgress: jest.fn().mockResolvedValue({ success: true })
    };

    // Mock spawned agent
    mockSpawnedAgent = {
      generation: 1.2,
      agentId: 'agent-child-123',
      generateResponse: jest.fn().mockResolvedValue({
        content: 'Task completed successfully',
        toolCalls: [],
        toolResults: []
      })
    };

    // Mock parent agent
    mockAgent = {
      generation: 1.1,
      agentId: 'agent-parent-123',
      role: 'orchestrator',
      spawnSubagent: jest.fn().mockResolvedValue(mockSpawnedAgent),
      delegateTask: jest.fn().mockResolvedValue({
        content: 'Delegated task completed',
        toolCalls: [],
        toolResults: []
      })
    };

    taskTool = new TaskTool({
      progressTracker: mockProgressTracker
    });
    taskTool.setAgent(mockAgent);
    taskTool.setSessionId('test-session-123');
  });

  describe('sendMessage', () => {
    it('should fail without required parameters', async () => {
      const result = await taskTool.sendMessage({});
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('recipientId and messageType are required');
    });

    it('should fail with invalid message type', async () => {
      const result = await taskTool.sendMessage({
        recipientId: 'agent-123',
        messageType: 'invalid_type',
        content: 'test message'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid message type');
    });

    it('should successfully send status_update message', async () => {
      const result = await taskTool.sendMessage({
        recipientId: 'agent-child-456',
        messageType: 'status_update',
        content: 'Task 50% complete',
        priority: 'medium'
      });
      
      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(result.messageId).toMatch(/^msg_/);
      expect(result.timestamp).toBeDefined();
      expect(result.senderId).toBe('agent-parent-123');
      expect(result.recipientId).toBe('agent-child-456');
    });

    it('should send request_help message with high priority', async () => {
      const result = await taskTool.sendMessage({
        recipientId: 'agent-parent-123',
        messageType: 'request_help',
        content: 'Stuck on error: permission denied',
        priority: 'high'
      });
      
      expect(result.success).toBe(true);
      expect(result.priority).toBe('high');
      expect(result.messageType).toBe('request_help');
    });

    it('should handle share_result message with large content', async () => {
      const largeContent = 'x'.repeat(1001);
      const result = await taskTool.sendMessage({
        recipientId: 'agent-sibling-789',
        messageType: 'share_result',
        content: largeContent
      });
      
      expect(result.success).toBe(true);
      expect(result.contentTruncated).toBe(true);
      expect(result.originalLength).toBe(1001);
    });

    it('should send coordination message between siblings', async () => {
      const result = await taskTool.sendMessage({
        recipientId: 'agent-sibling-321',
        messageType: 'coordination',
        content: 'Ready to proceed with step 2',
        priority: 'low'
      });
      
      expect(result.success).toBe(true);
      expect(result.messageType).toBe('coordination');
    });
  });

  describe('receiveMessages', () => {
    it('should return empty array when no messages exist', async () => {
      const result = await taskTool.receiveMessages();
      
      expect(result.success).toBe(true);
      expect(result.messages).toEqual([]);
      expect(result.unreadCount).toBe(0);
    });

    it('should filter messages by type', async () => {
      // First send some messages
      await taskTool.sendMessage({
        recipientId: mockAgent.agentId,
        messageType: 'status_update',
        content: 'Status message'
      });
      
      await taskTool.sendMessage({
        recipientId: mockAgent.agentId,
        messageType: 'request_help',
        content: 'Help message'
      });

      // Receive only status_update messages
      const result = await taskTool.receiveMessages({
        messageType: 'status_update'
      });
      
      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].messageType).toBe('status_update');
      expect(result.messages[0].content).toBe('Status message');
      expect(result.unreadCount).toBe(1);
    });

    it('should limit number of messages returned', async () => {
      // Send multiple messages
      for (let i = 0; i < 5; i++) {
        await taskTool.sendMessage({
          recipientId: mockAgent.agentId,
          messageType: 'status_update',
          content: `Message ${i}`
        });
      }

      const result = await taskTool.receiveMessages({ limit: 3 });
      
      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(3);
      expect(result.totalMessages).toBe(5);
    });

    it('should mark messages as read', async () => {
      await taskTool.sendMessage({
        recipientId: mockAgent.agentId,
        messageType: 'coordination',
        content: 'Test message'
      });

      // First receive should mark as read
      const result1 = await taskTool.receiveMessages({ markAsRead: true });
      expect(result1.unreadCount).toBe(1);
      
      // Second receive should show no unread
      const result2 = await taskTool.receiveMessages();
      expect(result2.unreadCount).toBe(0);
    });

    it('should include sender information', async () => {
      await taskTool.sendMessage({
        recipientId: mockAgent.agentId,
        messageType: 'share_result',
        content: 'Result data'
      });

      const result = await taskTool.receiveMessages();
      
      expect(result.success).toBe(true);
      expect(result.messages[0].senderId).toBe(mockAgent.agentId);
      expect(result.messages[0].senderRole).toBe('orchestrator');
    });
  });

  describe('Message Queue Management', () => {
    it('should automatically cleanup old messages', async () => {
      // Mock Date.now to control time
      const originalDateNow = Date.now;
      const mockTime = 1000000;
      Date.now = jest.fn(() => mockTime);

      try {
        // Send message to current agent
        await taskTool.sendMessage({
          recipientId: mockAgent.agentId,
          messageType: 'status_update',
          content: 'Old message'
        });

        // Advance time past cleanup threshold (assume 1 hour = 3600000ms)
        Date.now = jest.fn(() => mockTime + 3700000);

        // Send another message to trigger cleanup
        await taskTool.sendMessage({
          recipientId: mockAgent.agentId,
          messageType: 'status_update',
          content: 'New message'
        });

        // Old message should be cleaned up when we receive messages
        const result = await taskTool.receiveMessages();
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].content).toBe('New message');
      } finally {
        Date.now = originalDateNow;
      }
    });

    it('should handle message queue size limits', async () => {
      // Send many messages to test queue limits
      for (let i = 0; i < 150; i++) {
        await taskTool.sendMessage({
          recipientId: 'agent-overflow',
          messageType: 'coordination',
          content: `Message ${i}`
        });
      }

      const result = await taskTool.receiveMessages({ limit: 200 });
      
      // Should respect maximum queue size (assume 100 message limit)
      expect(result.messages.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Agent Relationship Tracking', () => {
    it('should track parent-child relationships when spawning agents', async () => {
      const spawnResult = await taskTool.spawnAgent({
        role: 'specialist',
        task: 'Analyze data',
        model: 'claude-3-5-haiku-20241022'
      });

      expect(spawnResult.success).toBe(true);
      
      // Check that relationship is tracked
      const relationships = taskTool.getAgentRelationships();
      expect(relationships).toBeDefined();
      expect(relationships[mockSpawnedAgent.generation]).toEqual({
        parentId: mockAgent.agentId,
        role: 'specialist',
        status: 'active'
      });
    });

    it('should allow sibling agents to message each other', async () => {
      // Simulate two child agents
      const sibling1 = 'agent-child-1';
      const sibling2 = 'agent-child-2';
      
      // Set up relationships (both children of current agent)
      taskTool.registerAgentRelationship(sibling1, {
        parentId: mockAgent.agentId,
        role: 'worker',
        status: 'active'
      });
      
      taskTool.registerAgentRelationship(sibling2, {
        parentId: mockAgent.agentId,
        role: 'worker', 
        status: 'active'
      });

      // Agent 1 sends message to Agent 2
      const sendResult = await taskTool.sendMessage({
        recipientId: sibling2,
        messageType: 'coordination',
        content: 'Coordination message between siblings'
      });

      expect(sendResult.success).toBe(true);
      expect(sendResult.recipientId).toBe(sibling2);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing agent context gracefully', async () => {
      const orphanTool = new TaskTool();
      
      const result = await orphanTool.sendMessage({
        recipientId: 'agent-123',
        messageType: 'status_update',
        content: 'test'
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('must be called from within an agent context');
    });

    it('should validate message content length', async () => {
      const veryLongContent = 'x'.repeat(2000);
      
      const result = await taskTool.sendMessage({
        recipientId: 'agent-123',
        messageType: 'status_update',
        content: veryLongContent
      });
      
      expect(result.success).toBe(true);
      expect(result.contentTruncated).toBe(true);
      expect(result.content.length).toBeLessThan(veryLongContent.length);
    });

    it('should handle corrupted message queue gracefully', async () => {
      // Simulate corrupted state
      taskTool.messageQueue = null;
      
      const result = await taskTool.receiveMessages();
      
      expect(result.success).toBe(true);
      expect(result.messages).toEqual([]);
      expect(result.error).toContain('Message queue corrupted');
    });
  });
});
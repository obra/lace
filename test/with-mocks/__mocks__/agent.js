// Mock Agent for Jest tests
import { jest } from '@jest/globals';

export class Agent {
  constructor(config = {}) {
    this.role = config.role || 'orchestrator';
    this.assignedModel = config.assignedModel || 'claude-3-5-sonnet-20241022';
    this.generation = config.generation || 0;
    this.contextSize = 0;
    this.maxContextSize = 200000;
    this.debugLogger = config.debugLogger || null;
    this.activityLogger = config.activityLogger || null;
    this.task = config.task || null;
    this.assignedProvider = config.assignedProvider || 'anthropic';
    this.capabilities = config.capabilities || ['reasoning'];
  }
  
  processInput = jest.fn().mockResolvedValue({
    content: 'Test response',
    usage: { total_tokens: 100 }
  });
  
  getConversationHistory = jest.fn(() => Promise.resolve([]));
  executeTool = jest.fn(() => Promise.resolve({ success: true }));
  shouldHandoff = jest.fn(() => false);
  buildToolsForLLM = jest.fn(() => []);
  spawnSubagent = jest.fn((options) => Promise.resolve(new Agent(options)));
  chooseAgentForTask = jest.fn((task) => {
    const taskLower = task.toLowerCase();
    if (taskLower.includes('plan') || taskLower.includes('design') || taskLower.includes('architect')) {
      return {
        role: 'planning',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['planning', 'reasoning', 'analysis']
      };
    }
    if (taskLower.includes('run') || taskLower.includes('execute') || taskLower.includes('list') || taskLower.includes('show')) {
      return {
        role: 'execution',
        assignedModel: 'claude-3-5-haiku-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['execution', 'tool_calling']
      };
    }
    if (taskLower.includes('analyze') || taskLower.includes('explain') || taskLower.includes('debug') || taskLower.includes('fix')) {
      return {
        role: 'reasoning',
        assignedModel: 'claude-3-5-sonnet-20241022',
        assignedProvider: 'anthropic',
        capabilities: ['reasoning', 'analysis', 'debugging']
      };
    }
    return {
      role: 'general',
      assignedModel: 'claude-3-5-sonnet-20241022',
      assignedProvider: 'anthropic',
      capabilities: ['reasoning', 'tool_calling']
    };
  });
}
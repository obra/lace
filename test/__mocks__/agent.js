// Mock Agent for Jest tests
import { jest } from '@jest/globals';

export class Agent {
  constructor(config) {
    this.role = config.role || 'orchestrator';
    this.assignedModel = config.assignedModel || 'claude-3-5-sonnet-20241022';
    this.generation = config.generation || 0;
  }
  
  processInput = jest.fn().mockResolvedValue({
    content: 'Test response',
    usage: { total_tokens: 100 }
  });
}
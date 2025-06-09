// Mock ConversationDB for Jest tests
import { jest } from '@jest/globals';

export class ConversationDB {
  constructor(path) {
    this.path = path;
  }
  
  initialize = jest.fn().mockResolvedValue(undefined);
  saveMessage = jest.fn().mockResolvedValue(undefined);
  getMessages = jest.fn().mockResolvedValue([]);
  close = jest.fn().mockResolvedValue(undefined);
}
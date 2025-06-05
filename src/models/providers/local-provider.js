// ABOUTME: Local model provider for on-premise deployments
// ABOUTME: Will support DeepSeek and other local models via Ollama or direct API

import { randomUUID } from 'crypto';

export class LocalProvider {
  constructor(config = {}) {
    this.config = config;
    this.conversationSessions = new Map(); // Track conversation session IDs
    // TODO: Implement local provider (Ollama, etc.)
  }

  async initialize() {
    throw new Error('Local provider not yet implemented');
  }

  async chat(messages, options = {}) {
    const { conversationId = null } = options;
    
    // Get or create conversation session ID
    const sessionId = this.getOrCreateSessionId(conversationId, messages);
    
    // TODO: Implement actual local model API calls
    throw new Error('Local provider not yet implemented');
  }

  getOrCreateSessionId(conversationId, messages) {
    // Use provided conversation ID if available
    if (conversationId) {
      return conversationId;
    }
    
    // Generate a conversation key based on the first user message or create a unique key
    const conversationKey = this.generateConversationKey(messages);
    
    // Check if we already have a session ID for this conversation
    if (this.conversationSessions.has(conversationKey)) {
      return this.conversationSessions.get(conversationKey);
    }
    
    // Generate new session ID
    const sessionId = randomUUID();
    this.conversationSessions.set(conversationKey, sessionId);
    
    return sessionId;
  }

  generateConversationKey(messages) {
    // Use the first non-system message as the conversation key
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    if (firstUserMessage) {
      // Create a simple hash-like key from the first user message
      return `conv_${firstUserMessage.content.slice(0, 50).replace(/\s+/g, '_')}`;
    }
    
    // Fallback to timestamp-based key
    return `conv_${Date.now()}`;
  }

  getInfo() {
    return {
      name: 'local',
      models: [
        'deepseek-v3',
        'llama-3.3',
        'qwen-2.5'
      ],
      capabilities: [
        'chat',
        'local_inference',
        'privacy'
      ]
    };
  }
}
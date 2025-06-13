// ABOUTME: Conversation class that encapsulates conversation state and persistence
// ABOUTME: Hides ConversationDB as implementation detail behind clean object interface

import { ConversationDB } from '../database/conversation-db.js';
import { Message, ConversationMetadata, MessageUtils, ToolCall, ToolExecution } from './message.js';

export class Conversation {
  private constructor(
    private sessionId: string,
    private db: ConversationDB,
    private metadata: ConversationMetadata
  ) {}

  /**
   * Load an existing conversation or create a new one
   */
  static async load(sessionId: string, dbPath?: string): Promise<Conversation> {
    const db = new ConversationDB(dbPath);
    await db.initialize();

    // Check if conversation exists
    const existingMessages = await db.getConversationHistory(sessionId, 1);
    
    let metadata: ConversationMetadata;
    if (existingMessages && existingMessages.length > 0) {
      // Load existing conversation metadata
      const allMessages = await db.getConversationHistory(sessionId);
      metadata = {
        sessionId,
        createdAt: allMessages[allMessages.length - 1]?.timestamp || Date.now(),
        lastActivity: allMessages[0]?.timestamp || Date.now(),
        messageCount: allMessages.length,
        totalTokens: allMessages.reduce((sum, msg) => sum + (msg.context_size || 0), 0)
      };
    } else {
      // Create new conversation metadata
      metadata = {
        sessionId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        totalTokens: 0
      };
    }

    return new Conversation(sessionId, db, metadata);
  }

  /**
   * Add a message to the conversation
   */
  async addMessage(
    role: Message['role'], 
    content: string, 
    toolCalls?: ToolCall[], 
    generation?: number,
    contextSize?: number
  ): Promise<void> {
    await this.db.saveMessage(
      this.sessionId,
      generation || 0,
      role,
      content,
      toolCalls ? JSON.stringify(toolCalls) : null,
      contextSize || 0
    );

    // Update metadata
    this.metadata.lastActivity = Date.now();
    this.metadata.messageCount++;
    if (contextSize) {
      this.metadata.totalTokens = (this.metadata.totalTokens || 0) + contextSize;
    }
  }

  /**
   * Get messages from the conversation
   */
  async getMessages(limit?: number): Promise<Message[]> {
    const dbMessages = await this.db.getConversationHistory(this.sessionId, limit);
    
    if (!dbMessages) return [];

    return dbMessages.map(dbMsg => {
      const message: Message = {
        id: dbMsg.id?.toString(),
        role: dbMsg.role as Message['role'],
        content: dbMsg.content,
        timestamp: dbMsg.timestamp,
        generation: dbMsg.generation,
        contextSize: dbMsg.context_size,
      };

      // Handle tool calls or tool execution data
      if (dbMsg.tool_calls && dbMsg.tool_calls !== 'null') {
        try {
          const parsed = JSON.parse(dbMsg.tool_calls);
          if (parsed.toolExecution) {
            // This is a tool execution record
            message.toolExecution = parsed.toolExecution;
          } else {
            // This is regular tool calls
            message.toolCalls = parsed;
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      return message;
    });
  }

  /**
   * Search messages in the conversation
   */
  async search(query: string, limit?: number): Promise<Message[]> {
    const dbMessages = await this.db.searchConversations(this.sessionId, query, limit);
    
    if (!dbMessages) return [];

    return dbMessages.map(dbMsg => ({
      id: dbMsg.id?.toString(),
      role: dbMsg.role as Message['role'],
      content: dbMsg.content,
      timestamp: dbMsg.timestamp,
      generation: dbMsg.generation,
      contextSize: dbMsg.context_size,
      ...(dbMsg.tool_calls && dbMsg.tool_calls !== 'null' && {
        toolCalls: JSON.parse(dbMsg.tool_calls)
      })
    }));
  }

  /**
   * Get messages formatted for LLM consumption (without DB-specific fields)
   */
  async getFormattedMessages(limit?: number, excludeLatest = true): Promise<any[]> {
    const messages = await this.getMessages(limit);
    
    if (!messages || messages.length === 0) return [];

    // Skip the most recent message if excludeLatest is true (to avoid including current user message)
    const startIndex = excludeLatest ? Math.min(1, messages.length) : 0;
    const messagesToFormat = messages.slice(startIndex);

    // Reverse to get chronological order (DB returns DESC)
    return messagesToFormat.reverse()
      .filter(msg => msg.role !== 'tool') // Filter out tool execution messages - they're for UI only
      .map(msg => {
        const formatted: any = {
          role: msg.role,
          content: msg.content
        };

        // Add tool_calls if present
        if (msg.toolCalls) {
          formatted.tool_calls = msg.toolCalls;
        }

        return formatted;
      });
  }

  /**
   * Get messages for a specific generation
   */
  async getGenerationMessages(generation: number): Promise<Message[]> {
    const dbMessages = await this.db.getGenerationHistory(this.sessionId, generation);
    
    if (!dbMessages) return [];

    return dbMessages.map(dbMsg => ({
      id: dbMsg.id?.toString(),
      role: dbMsg.role as Message['role'],
      content: dbMsg.content,
      timestamp: dbMsg.timestamp,
      generation: dbMsg.generation,
      contextSize: dbMsg.context_size,
      ...(dbMsg.tool_calls && dbMsg.tool_calls !== 'null' && {
        toolCalls: JSON.parse(dbMsg.tool_calls)
      })
    }));
  }

  /**
   * Get conversation metadata
   */
  getMetadata(): ConversationMetadata {
    return { ...this.metadata };
  }

  /**
   * Get session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Close the conversation and cleanup resources
   */
  async close(): Promise<void> {
    await this.db.close();
  }

  // Convenience methods using MessageUtils
  async addUserMessage(content: string): Promise<void> {
    await this.addMessage('user', content);
  }

  async addAssistantMessage(content: string, toolCalls?: ToolCall[]): Promise<void> {
    await this.addMessage('assistant', content, toolCalls);
  }

  async addSystemMessage(content: string): Promise<void> {
    await this.addMessage('system', content);
  }

  /**
   * Add a tool execution record to the conversation
   */
  async addToolExecution(toolCall: ToolCall, result: any, error?: string, duration?: number): Promise<void> {
    const status = error ? 'failed' : 'completed';
    const toolExecution: ToolExecution = {
      toolCall,
      result,
      error,
      status,
      duration
    };

    // Create a readable content string for the tool execution
    const content = `🔧 Tool: ${toolCall.name}\n📥 Input: ${JSON.stringify(toolCall.input, null, 2)}\n${error ? `❌ Error: ${error}` : `✅ Output: ${JSON.stringify(result, null, 2)}`}`;

    // Store as a special tool message type
    await this.db.saveMessage(
      this.sessionId,
      0, // generation
      'tool',
      content,
      JSON.stringify({ toolExecution }), // Store full execution data in tool_calls field
      0 // contextSize
    );

    // Update metadata
    this.metadata.lastActivity = Date.now();
    this.metadata.messageCount++;
  }

  async getRecentMessages(count: number): Promise<Message[]> {
    const messages = await this.getMessages();
    return MessageUtils.getRecent(messages, count);
  }

  async getUserMessages(): Promise<Message[]> {
    const messages = await this.getMessages();
    return MessageUtils.filterByRole(messages, 'user');
  }

  async getAssistantMessages(): Promise<Message[]> {
    const messages = await this.getMessages();
    return MessageUtils.filterByRole(messages, 'assistant');
  }
}
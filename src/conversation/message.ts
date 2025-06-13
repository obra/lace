// ABOUTME: Clean message interface and types for conversation system
// ABOUTME: Consolidates scattered message types across the codebase into single source of truth

export interface ToolCall {
  name: string;
  input: any;
  id?: string;
}

export interface ToolExecution {
  toolCall: ToolCall;
  result: any;
  error?: string;
  status: 'completed' | 'failed' | 'denied';
  duration?: number;
}

export interface Message {
  id?: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  toolExecution?: ToolExecution; // For tool execution records
  generation?: number;
  contextSize?: number;
}

export interface ConversationMetadata {
  sessionId: string;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  totalTokens?: number;
}

// Helper functions for message operations
export class MessageUtils {
  static createUserMessage(content: string): Message {
    return {
      role: 'user',
      content,
      timestamp: Date.now()
    };
  }

  static createAssistantMessage(content: string, toolCalls?: ToolCall[]): Message {
    return {
      role: 'assistant',
      content,
      timestamp: Date.now(),
      ...(toolCalls && { toolCalls })
    };
  }

  static createSystemMessage(content: string): Message {
    return {
      role: 'system',
      content,
      timestamp: Date.now()
    };
  }

  static filterByRole(messages: Message[], role: Message['role']): Message[] {
    return messages.filter(msg => msg.role === role);
  }

  static getRecent(messages: Message[], count: number): Message[] {
    return messages.slice(-count);
  }

  static search(messages: Message[], query: string): Message[] {
    const lowercaseQuery = query.toLowerCase();
    return messages.filter(msg => 
      msg.content.toLowerCase().includes(lowercaseQuery)
    );
  }
}
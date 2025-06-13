// ABOUTME: Model instance interfaces for stateful AI model sessions with caching support
// ABOUTME: Provides chat capabilities and session management for individual model instances

import { ModelDefinition } from './model-definition.js';

export interface ModelInstance {
  definition: ModelDefinition;
  chat(messages: any[], options?: ChatOptions): Promise<any>;
}

export interface ChatOptions {
  tools?: any[];
  maxTokens?: number;
  temperature?: number;
  onTokenUpdate?: (update: any) => void;
  provider?: string;  // For backward compatibility with ModelProvider
  model?: string;     // For backward compatibility with ModelProvider
  signal?: AbortSignal;
  enableCaching?: boolean;
}

export interface SessionOptions {
  sessionId?: string;
  enableCaching?: boolean;
}
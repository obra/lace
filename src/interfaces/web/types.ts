// ABOUTME: TypeScript interfaces for web interface request context
// ABOUTME: Re-exports all web types plus new request context interface

import type { IncomingMessage } from 'http';
import type { Agent } from '~/agents/agent';

// Re-export all existing web interface types
export * from './types/chat.js';

// New request context interface for passing Agent to API routes
export interface LaceRequest extends IncomingMessage {
  laceAgent?: Agent;
}

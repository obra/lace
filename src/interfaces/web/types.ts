// ABOUTME: TypeScript interfaces for web interface request context
// ABOUTME: Extends Node.js IncomingMessage to include Lace Agent instance

import type { IncomingMessage } from 'http';
import type { Agent } from '~/agents/agent';

export interface LaceRequest extends IncomingMessage {
  laceAgent?: Agent;
}

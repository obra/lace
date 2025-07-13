// ABOUTME: Type definitions for the web interface chat system
// ABOUTME: Includes message types, stream events, and UI state interfaces

// Strongly typed thread ID
export type ThreadId = string & { readonly __brand: 'ThreadId' };

// Helper function to create ThreadId from string
export function createThreadId(id: string): ThreadId {
  return id as ThreadId;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface StreamEvent {
  type:
    | 'connection'
    | 'thinking_start'
    | 'thinking_complete'
    | 'token'
    | 'tool_call_start'
    | 'tool_call_complete'
    | 'response_complete'
    | 'conversation_complete'
    | 'error';
  content?: string;
  error?: string;
  timestamp?: string;
  threadId?: ThreadId;
  isNew?: boolean;
  provider?: string;
  model?: string;
  toolCall?: {
    name: string;
    id: string;
    parameters?: unknown;
  };
  result?: {
    success: boolean;
    content: string;
    isError: boolean;
  };
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error?: string;
}

export interface TimelineEntry {
  id: string | number;
  type: 'admin' | 'human' | 'ai' | 'tool' | 'integration' | 'carousel';
  content?: string;
  timestamp: Date;
  agent?: string;
  tool?: string;
  result?: string;
  action?: string;
  title?: string;
  description?: string;
  link?: string;
  items?: CarouselItem[];
}

export interface CarouselItem {
  title: string;
  description: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'maintenance';
  impact: 'high' | 'medium' | 'low';
  files: string[];
  commit: string;
}

export interface Project {
  id: number;
  name: string;
  path: string;
}

export interface Timeline {
  threadId: ThreadId;
  name: string;
  agent: 'Claude' | 'GPT-4' | 'Gemini';
}

export interface Task {
  id: number;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  assignee: string;
  status: 'pending' | 'in_progress' | 'review' | 'completed';
}

export interface RecentFile {
  name: string;
  path: string;
}

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

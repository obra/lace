// ABOUTME: Design system specific types imported from f-web-spicy
// ABOUTME: Essential interfaces for UI components, timeline, and chat functionality

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
    | 'ready_for_input'
    | 'error';
  content?: string;
  error?: string;
  timestamp?: string;
  threadId?: string;
  isNewThread?: boolean;
  isNewAgent?: boolean;
  provider?: string;
  model?: string;
  connectionKey?: string;
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

export interface GoogleDocAttachment {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  lastModified: Date;
  owner: string;
  permissions: 'view' | 'comment' | 'edit';
  preview?: string;
}

export interface TimelineEntry {
  id: string | number;
  type: 'admin' | 'human' | 'ai' | 'tool' | 'integration' | 'carousel' | 'google-doc' | 'unknown';
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
  document?: GoogleDocAttachment;
  // Unknown event specific fields
  eventType?: string;
  metadata?: Record<string, unknown>;
}

export interface CarouselItem {
  title: string;
  description: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'maintenance';
  impact: 'high' | 'medium' | 'low';
  files: string[];
  commit: string;
}

export interface Timeline {
  id: number;
  name: string;
  agent: 'Claude' | 'GPT-4' | 'Gemini';
}

export interface RecentFile {
  name: string;
  path: string;
  lastModified?: Date;
  size?: number;
}

export interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

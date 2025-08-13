// ABOUTME: Design system specific types imported from f-web-spicy
// ABOUTME: Essential interfaces for UI components, timeline, and chat functionality

import type { ToolResult } from '@/types/core';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ChatState {
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

interface Theme {
  name: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
  };
}

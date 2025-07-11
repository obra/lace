export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface StreamEvent {
  type: 'start' | 'chunk' | 'complete' | 'tool_start' | 'tool_complete' | 'error';
  content?: string;
  tool?: string;
  error?: string;
  message?: string;
  exitCode?: number;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error?: string;
}
// ABOUTME: Agent conversation hook providing message management with multi-agent architecture
// ABOUTME: Handles user input, message sending, and streaming responses for specific agents

import { useState, useCallback } from 'react';
import type { Message } from '~/interfaces/web/types';
import { useConversationStream, type StreamRequest } from '~/interfaces/web/hooks/useConversationStream';
import { logger } from '../utils/client-logger';

export interface UseAgentConversationOptions {
  agentId?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
}

const INITIAL_MESSAGE: Message = {
  id: '1',
  role: 'assistant',
  content: "Hello! I'm Lace, your AI coding assistant. How can I help you today?",
  timestamp: new Date(),
};

export function useAgentConversation(options: UseAgentConversationOptions = {}) {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentAgentId, setCurrentAgentId] = useState<string | undefined>(options.agentId);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(options.sessionId);

  const updateMessageContent = useCallback((messageId: string, content: string) => {
    setMessages((prev) => prev.map((msg) => (msg.id === messageId ? { ...msg, content } : msg)));
  }, []);

  const { startStream, isStreaming } = useConversationStream({
    onToken: (content: string, messageId: string) => {
      updateMessageContent(messageId, content);
    },
    onComplete: (finalContent: string, messageId: string) => {
      updateMessageContent(messageId, finalContent);
      setIsLoading(false);
    },
    onError: (error: string, messageId?: string) => {
      if (messageId) {
        updateMessageContent(messageId, `Error: ${error}`);
      }
      setIsLoading(false);
    },
  });

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    // Create assistant message for streaming
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const streamRequest: StreamRequest = {
        message: userMessage.content,
        agentId: currentAgentId,
        sessionId: currentSessionId,
        provider: options.provider,
        model: options.model,
      };
      
      const response = await startStream(streamRequest, assistantMessageId);

      // Update agent/session IDs if they were created
      if (response?.agentId && response.agentId !== currentAgentId) {
        setCurrentAgentId(response.agentId);
      }
      if (response?.sessionId && response.sessionId !== currentSessionId) {
        setCurrentSessionId(response.sessionId);
      }
    } catch (error) {
      logger.error('Error calling agent conversation API:', error);
      updateMessageContent(
        assistantMessageId,
        'Sorry, there was an error connecting to the agent. Please try again.'
      );
      setIsLoading(false);
    }
  }, [input, isLoading, isStreaming, currentAgentId, currentSessionId, options.provider, options.model, startStream, updateMessageContent]);

  const switchAgent = useCallback((agentId: string, sessionId?: string) => {
    setCurrentAgentId(agentId);
    if (sessionId) {
      setCurrentSessionId(sessionId);
    }
    // TODO: Load conversation history for the new agent
  }, []);

  const loadAgentHistory = useCallback(async (agentId: string) => {
    try {
      const response = await fetch(`/api/conversations?agentId=${agentId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      // TODO: Convert agent events to Message format and set messages
      logger.debug('Agent history loaded:', data);
    } catch (error) {
      logger.error('Error loading agent history:', error);
    }
  }, []);

  return {
    messages,
    input,
    setInput,
    isLoading: isLoading || isStreaming,
    sendMessage,
    currentAgentId,
    currentSessionId,
    switchAgent,
    loadAgentHistory,
  };
}
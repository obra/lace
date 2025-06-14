// ABOUTME: Container component for managing conversation messages and state
// ABOUTME: Handles message loading from conversation and provides message context

import React, { useState, useEffect, createContext, useContext } from "react";
import { Conversation } from "../../../conversation/conversation.js";
import { Message } from "../../../conversation/message.js";

interface ToolCall {
  id?: string;
  name: string;
  input: any;
}

interface UsageData {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

interface TimingData {
  durationMs?: number;
}

type ConversationMessage =
  | { type: "user"; content: string }
  | { type: "assistant"; content: string; tool_calls?: ToolCall[]; usage?: UsageData }
  | { type: "loading"; content: string }
  | { type: "streaming"; content: string; isStreaming: boolean; usage?: UsageData }
  | {
      type: "agent_activity";
      summary: string;
      content: string[];
      folded: boolean;
      timing?: TimingData;
    };

interface MessageContextValue {
  messages: ConversationMessage[];
  addMessage: (message: ConversationMessage) => void;
  updateMessages: (messages: ConversationMessage[]) => void;
  clearMessages: () => void;
  reloadFromConversation: () => void;
}

const MessageContext = createContext<MessageContextValue | null>(null);

export const useMessages = () => {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error("useMessages must be used within a MessageContainer");
  }
  return context;
};

interface MessageContainerProps {
  conversation?: Conversation;
  children: React.ReactNode;
}

export const MessageContainer: React.FC<MessageContainerProps> = ({ 
  conversation, 
  children 
}) => {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);

  const addMessage = (message: ConversationMessage) => {
    setMessages(prev => [...prev, message]);
  };

  const updateMessages = (newMessages: ConversationMessage[]) => {
    setMessages(newMessages);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const reloadFromConversation = async () => {
    if (conversation) {
      try {
        const conversationMessages = await conversation.getMessages();
        const uiMessages: ConversationMessage[] = [];

        conversationMessages.forEach((msg: Message) => {
          if (msg.role === "user") {
            uiMessages.push({
              type: "user" as const,
              content: msg.content,
            });
          } else if (msg.role === "tool") {
            // Tool messages are typically part of assistant responses, skip for now
          } else if (msg.role === "assistant") {
            uiMessages.push({
              type: "assistant" as const,
              content: msg.content,
              tool_calls: msg.toolCalls,
              // Note: usage is not available on Message type - would need to be tracked separately
            });
          }
        });

        setMessages(uiMessages);
      } catch (error) {
        console.error("Error loading conversation messages:", error);
      }
    }
  };

  // Load existing messages when conversation changes
  useEffect(() => {
    reloadFromConversation();
  }, [conversation]);

  const contextValue: MessageContextValue = {
    messages,
    addMessage,
    updateMessages,
    clearMessages,
    reloadFromConversation,
  };

  return (
    <MessageContext.Provider value={contextValue}>
      {children}
    </MessageContext.Provider>
  );
};

export { ConversationMessage };
export default MessageContainer;
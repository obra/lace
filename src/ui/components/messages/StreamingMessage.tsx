// ABOUTME: Component for handling real-time streaming of assistant responses
// ABOUTME: Manages streaming state and token accumulation with visual indicators

import React, { useRef, useEffect, useState } from "react";
import { useMessages } from "./MessageContainer";

interface StreamingMessageProps {
  isStreaming: boolean;
  onStreamingChange: (isStreaming: boolean) => void;
}

export const StreamingMessage: React.FC<StreamingMessageProps> = ({
  isStreaming,
  onStreamingChange,
}) => {
  const { messages, updateMessages } = useMessages();
  const streamingRef = useRef<{ content: string }>({ content: "" });
  
  const handleStreamingToken = (token: string) => {
    if (!isStreaming) return;

    streamingRef.current.content += token;

    // Update the last streaming message in the messages array
    updateMessages(messages.map((msg, index) => {
      if (index === messages.length - 1 && msg.type === "streaming") {
        return {
          ...msg,
          content: streamingRef.current.content,
          isStreaming: true,
        };
      }
      return msg;
    }));
  };

  const startStreaming = () => {
    streamingRef.current.content = "";
    onStreamingChange(true);
    
    // Add initial streaming message
    const streamingMessage = {
      type: "streaming" as const,
      content: "",
      isStreaming: true,
    };
    
    updateMessages([...messages, streamingMessage]);
  };

  const stopStreaming = () => {
    onStreamingChange(false);
    
    // Convert streaming message to assistant message
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.type === "streaming") {
        const assistantMessage = {
          type: "assistant" as const,
          content: streamingRef.current.content,
        };
        
        updateMessages([...messages.slice(0, -1), assistantMessage]);
      }
    }
    
    streamingRef.current.content = "";
  };

  // Expose streaming functions for parent components to use
  useEffect(() => {
    // Store references to streaming functions on the component
    (StreamingMessage as any).handleStreamingToken = handleStreamingToken;
    (StreamingMessage as any).startStreaming = startStreaming;
    (StreamingMessage as any).stopStreaming = stopStreaming;
  }, [isStreaming, messages]);

  return null; // This is an invisible component that manages streaming state
};

export default StreamingMessage;
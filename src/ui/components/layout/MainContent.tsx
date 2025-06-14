// ABOUTME: Simple content switcher component for conversation vs log view
// ABOUTME: Handles switching between ConversationView and DetailedLogView

import React from "react";
import ConversationView from "../ConversationView";
import DetailedLogView from "../DetailedLogView";
import { ConversationMessage } from "../messages/MessageContainer";

interface ConversationViewProps {
  conversation: ConversationMessage[];
  scrollPosition: number;
  isNavigationMode: boolean;
  filterMode: string;
  searchTerm: string;
  searchResults?: any[];
  scrollRef?: React.RefObject<any>;
}

interface LogViewProps {
  conversation: ConversationMessage[];
  scrollPosition: number;
  isNavigationMode: boolean;
}

interface MainContentProps {
  viewMode: 'conversation' | 'log';
  conversationProps: ConversationViewProps;
  logViewProps: LogViewProps;
}

export const MainContent: React.FC<MainContentProps> = ({
  viewMode,
  conversationProps,
  logViewProps,
}) => {
  return viewMode === 'conversation' ? (
    <ConversationView {...conversationProps} />
  ) : (
    <DetailedLogView {...logViewProps} />
  );
};

export default MainContent;
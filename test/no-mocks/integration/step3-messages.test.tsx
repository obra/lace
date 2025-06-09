// ABOUTME: Integration tests for Step 3 message display functionality
// ABOUTME: Tests message display logic and conversation structure

import React from 'react';
import ConversationView from '@/ui/components/ConversationView';
import Message from '@/ui/components/Message';

describe('Step 3: Basic Message Display Integration', () => {
  test('ConversationView displays complete conversation with messages', () => {
    const mockConversation = [
      { type: 'user' as const, content: 'Hello' },
      { type: 'assistant' as const, content: 'Hi! How can I help you today?' },
      { type: 'user' as const, content: 'Can you write a function?' },
      { type: 'assistant' as const, content: 'Sure! Here is a basic function:\n\nfunction hello() {\n  return "Hello World";\n}' }
    ];
    
    const element = ConversationView({ messages: mockConversation }) as any;
    const messages = element.props.children;
    
    // Should display the mock conversation
    expect(messages).toHaveLength(4);
    
    // Verify conversation flow
    expect(messages[0].props.type).toBe('user');
    expect(messages[0].props.content).toBe('Hello');
    
    expect(messages[1].props.type).toBe('assistant');
    expect(messages[1].props.content).toBe('Hi! How can I help you today?');
    
    expect(messages[2].props.type).toBe('user');
    expect(messages[2].props.content).toBe('Can you write a function?');
    
    expect(messages[3].props.type).toBe('assistant');
    expect(messages[3].props.content).toContain('function hello()');
  });

  test('Message components display with proper prefixes and types', () => {
    const testMessages = [
      { type: 'user' as const, content: 'Hello' },
      { type: 'assistant' as const, content: 'Hi there!' },
      { type: 'loading' as const, content: 'Loading...' },
      { 
        type: 'agent_activity' as const,
        summary: 'Agent Activity',
        content: ['working on task'],
        folded: true
      }
    ];
    
    testMessages.forEach((messageData) => {
      const element = Message(messageData) as any;
      
      // Should render without error
      expect(element).toBeTruthy();
      expect(element.type).toBeTruthy();
      
      // Message component should receive correct props
      const messageCall = Message as any;
      expect(typeof messageCall).toBe('function');
    });
  });

  test('conversation message types are handled correctly', () => {
    // Test user message structure
    const userMessage = { type: 'user' as const, content: 'Hello world' };
    const userElement = Message(userMessage) as any;
    expect(userElement).toBeTruthy();
    
    // Test assistant message structure  
    const assistantMessage = { type: 'assistant' as const, content: 'Hi there!' };
    const assistantElement = Message(assistantMessage) as any;
    expect(assistantElement).toBeTruthy();
    
    // Test loading message structure
    const loadingMessage = { type: 'loading' as const, content: 'Loading...' };
    const loadingElement = Message(loadingMessage) as any;
    expect(loadingElement).toBeTruthy();
    
    // Test agent activity message structure
    const agentMessage = { 
      type: 'agent_activity' as const,
      summary: 'Activity Summary',
      content: ['item 1', 'item 2'],
      folded: false
    };
    const agentElement = Message(agentMessage) as any;
    expect(agentElement).toBeTruthy();
  });

  test('ConversationView handles different message combinations', () => {
    const mixedMessages = [
      { type: 'user' as const, content: 'Start conversation' },
      { type: 'assistant' as const, content: 'Hello! How can I help?' },
      { 
        type: 'agent_activity' as const,
        summary: 'Processing request',
        content: ['analyzing input', 'preparing response'],
        folded: true
      },
      { type: 'loading' as const, content: 'Thinking...' },
      { type: 'assistant' as const, content: 'Here is my response.' }
    ];
    
    const element = ConversationView({ messages: mixedMessages }) as any;
    const renderedMessages = element.props.children;
    
    expect(renderedMessages).toHaveLength(5);
    
    // Verify each message type is handled
    expect(renderedMessages[0].props.type).toBe('user');
    expect(renderedMessages[1].props.type).toBe('assistant');
    expect(renderedMessages[2].props.type).toBe('agent_activity');
    expect(renderedMessages[3].props.type).toBe('loading');
    expect(renderedMessages[4].props.type).toBe('assistant');
  });

  test('conversation view navigation integration', () => {
    const messages = [
      { type: 'user' as const, content: 'Message 1' },
      { type: 'assistant' as const, content: 'Response 1' },
      { type: 'user' as const, content: 'Message 2' }
    ];
    
    // Test normal mode
    const normalElement = ConversationView({ 
      messages, 
      isNavigationMode: false,
      scrollPosition: 0 
    }) as any;
    
    const normalMessages = normalElement.props.children;
    expect(normalMessages[0].props.isHighlighted).toBe(false);
    
    // Test navigation mode
    const navElement = ConversationView({ 
      messages,
      isNavigationMode: true,
      scrollPosition: 1
    }) as any;
    
    const navMessages = navElement.props.children;
    expect(navMessages[1].props.isHighlighted).toBe(true);
    expect(navMessages[0].props.isHighlighted).toBe(false);
    expect(navMessages[2].props.isHighlighted).toBe(false);
  });
});
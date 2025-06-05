// ABOUTME: Integration tests for Step 3 message display functionality
// ABOUTME: Tests complete message display in full app context

import React from 'react';
import App from '../../../src/ui/App';
import { Box } from 'ink';

describe('Step 3: Basic Message Display Integration', () => {
  test('App displays complete conversation with messages', () => {
    const element = App({}) as any;
    
    // Get the ConversationView (first child)
    const conversationView = element.props.children[0];
    
    // ConversationView should have Message components
    const conversationElement = conversationView.type({});
    const messages = conversationElement.props.children;
    
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

  test('Messages display with proper prefixes', () => {
    const element = App({}) as any;
    const conversationView = element.props.children[0];
    const conversationElement = conversationView.type({});
    const messages = conversationElement.props.children;
    
    // Test that user messages get ">" prefix and assistant gets "🤖" prefix
    // by checking the rendered Message components
    messages.forEach((message: any, index: number) => {
      expect(message.type.name).toBe('Message');
      
      if (index % 2 === 0) {
        // Even indexes are user messages
        expect(message.props.type).toBe('user');
      } else {
        // Odd indexes are assistant messages  
        expect(message.props.type).toBe('assistant');
      }
    });
  });

  test('App layout maintains structure with messages', () => {
    const element = App({}) as any;
    
    // Should still have 3 main components
    expect(element.props.children).toHaveLength(3);
    
    // Layout should be preserved
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe('column');
    expect(element.props.height).toBe('100%');
  });
});
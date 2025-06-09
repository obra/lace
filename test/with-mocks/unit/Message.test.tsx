// ABOUTME: Unit tests for Message component
// ABOUTME: Tests message display with user/assistant types and content

import React from 'react';
import Message from '@/ui/components/Message';
import { Box, Text } from 'ink';

describe('Message Component', () => {
  test('renders user message with correct prefix and styling', () => {
    const element = Message({ type: 'user', content: 'Hello world' }) as any;
    
    // Should return a Box with column direction
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe('column');
    
    // Check the message content box
    const messageBox = element.props.children[0];
    expect(messageBox.type).toBe(Box);
    
    const [prefixElement, contentElement] = messageBox.props.children;
    
    // Prefix should be cyan ">" for user
    expect(prefixElement.type).toBe(Text);
    expect(prefixElement.props.color).toBe('cyan');
    expect(prefixElement.props.children).toBe('> ');
    
    // Content should be the message text
    expect(contentElement.type).toBe(Text);
    expect(contentElement.props.children).toBe('Hello world');
  });

  test('renders assistant message with correct prefix and styling', () => {
    const element = Message({ type: 'assistant', content: 'Hi there!' }) as any;
    
    const messageBox = element.props.children[0];
    const [prefixElement, contentElement] = messageBox.props.children;
    
    // Prefix should be green robot emoji for assistant
    expect(prefixElement.type).toBe(Text);
    expect(prefixElement.props.color).toBe('green');
    expect(prefixElement.props.children).toBe('🤖 ');
    
    // Content should be the message text
    expect(contentElement.type).toBe(Text);
    expect(contentElement.props.children).toBe('Hi there!');
  });

  test('handles multi-line content correctly', () => {
    const multiLineContent = 'Line 1\nLine 2\nLine 3';
    const element = Message({ type: 'assistant', content: multiLineContent }) as any;
    
    const messageBox = element.props.children[0];
    const [, contentElement] = messageBox.props.children;
    
    expect(contentElement.props.children).toBe(multiLineContent);
  });
});
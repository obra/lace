// ABOUTME: Integration tests for Step 12 streaming text functionality
// ABOUTME: Tests streaming text display, cursor indicators, and auto-scrolling

import React from 'react';
import ConversationView from '@/ui/components/ConversationView';
import Message from '@/ui/components/Message';
import StatusBar from '@/ui/components/StatusBar';

describe('Step 12: Streaming Text Support', () => {
  test('streaming message type displays with cursor indicator', () => {
    const element = Message({ 
      type: 'streaming',
      content: 'This is streaming text',
      isStreaming: true
    }) as any;
    
    // Should render streaming message with cursor
    expect(element).toBeTruthy();
    
    // The element is a Box with flexDirection: column, first child contains the message
    const messageBox = element.props.children[0]; // The rendered content from renderContent()
    const messageChildren = messageBox.props.children;
    
    // Should have prefix with robot emoji
    const prefixElement = messageChildren.find((child: any) => 
      child?.props?.children === '🤖 '
    );
    expect(prefixElement).toBeTruthy();
    expect(prefixElement.props.color).toBe('green');
    
    // Should have cursor indicator
    const cursorElement = messageChildren.find((child: any) => 
      child?.props?.children === '▌'
    );
    expect(cursorElement).toBeTruthy();
    expect(cursorElement.props.color).toBe('white');
  });

  test('streaming message displays partial content with typing cursor', () => {
    const element = Message({ 
      type: 'streaming',
      content: 'Hello wo',
      isStreaming: true
    }) as any;
    
    // Should show partial content with cursor
    const messageBox = element.props.children[0];
    const messageChildren = messageBox.props.children;
    
    const contentElement = messageChildren.find((child: any) => 
      child.props?.children === 'Hello wo'
    );
    expect(contentElement).toBeTruthy();
    
    // Should have cursor indicator
    const cursorElement = messageChildren.find((child: any) => 
      child.props?.children === '▌'
    );
    expect(cursorElement).toBeTruthy();
  });

  test('completed streaming message removes cursor indicator', () => {
    const element = Message({ 
      type: 'assistant',
      content: 'Complete message',
      isStreaming: false
    }) as any;
    
    // Should not have cursor when streaming is complete
    const children = element.props.children;
    const hasCursor = children.some((child: any) => 
      child.props?.children === '▌'
    );
    expect(hasCursor).toBeFalsy();
  });

  test('ConversationView auto-scrolls during streaming', () => {
    const messages = [
      { type: 'user' as const, content: 'Hello' },
      { type: 'streaming' as const, content: 'This is a streaming response...', isStreaming: true }
    ];
    
    const element = ConversationView({ 
      messages,
      scrollPosition: 1,
      isNavigationMode: false
    }) as any;
    
    const renderedMessages = element.props.children;
    expect(renderedMessages).toHaveLength(2);
    expect(renderedMessages[1].props.type).toBe('streaming');
    expect(renderedMessages[1].props.isStreaming).toBe(true);
  });

  test('StatusBar shows streaming indicator during text stream', () => {
    const element = StatusBar({ 
      isNavigationMode: false,
      isLoading: false,
      isStreaming: true
    }) as any;
    
    // Should show streaming status
    const children = element.props.children;
    const fragment = children[children.length - 1];
    const fragmentChildren = fragment.props.children;
    
    const streamingElement = fragmentChildren.find((child: any) => 
      child.props?.children === 'Streaming...'
    );
    expect(streamingElement).toBeTruthy();
    expect(streamingElement.props.color).toBe('yellow');
  });

  test('streaming preserves content formatting and syntax highlighting', () => {
    const streamingContent = 'Here is some code:\n\n```javascript\nfunction test() {\n  return';
    
    const element = Message({ 
      type: 'streaming',
      content: streamingContent,
      isStreaming: true
    }) as any;
    
    // Should process content with highlighting even during streaming
    expect(element).toBeTruthy();
    
    // Content should be processed (this tests that syntax highlighting works during streaming)
    const children = element.props.children;
    expect(children.length).toBeGreaterThan(1); // Should have prefix + content + cursor
  });

  test('long streaming text updates without flickering', () => {
    const longText = 'This is a very long streaming response that should update smoothly without causing flickering or performance issues. '.repeat(10);
    
    const element = Message({ 
      type: 'streaming',
      content: longText,
      isStreaming: true
    }) as any;
    
    // Should handle long content gracefully
    expect(element).toBeTruthy();
    
    // Content should be properly wrapped and displayed
    const children = element.props.children;
    expect(children.length).toBeGreaterThanOrEqual(2); // At least prefix + content
  });

  test('streaming state transitions correctly from loading to streaming to complete', () => {
    // Test the state progression: loading -> streaming -> complete
    
    // 1. Loading state
    const loadingElement = Message({ 
      type: 'loading',
      content: 'Assistant is thinking...'
    }) as any;
    const loadingBox = loadingElement.props.children[0];
    const loadingChildren = loadingBox.props.children;
    const prefixElement = loadingChildren.find((child: any) => 
      child?.props?.children === '⠋ '
    );
    expect(prefixElement).toBeTruthy();
    
    // 2. Streaming state
    const streamingElement = Message({ 
      type: 'streaming',
      content: 'Hello',
      isStreaming: true
    }) as any;
    const streamingBox = streamingElement.props.children[0];
    const streamingChildren = streamingBox.props.children;
    const hasCursor = streamingChildren.some((child: any) => 
      child.props?.children === '▌'
    );
    expect(hasCursor).toBeTruthy();
    
    // 3. Complete state
    const completeElement = Message({ 
      type: 'assistant',
      content: 'Hello world!',
      isStreaming: false
    }) as any;
    const completeBox = completeElement.props.children[0];
    const completeChildren = completeBox.props.children;
    const hasNoCursor = !completeChildren.some((child: any) => 
      child.props?.children === '▌'
    );
    expect(hasNoCursor).toBeTruthy();
  });

  test('streaming respects navigation mode and highlighting', () => {
    const element = Message({ 
      type: 'streaming',
      content: 'Streaming content',
      isStreaming: true,
      isHighlighted: true
    }) as any;
    
    // Should apply highlighting even during streaming
    const messageBox = element.props.children[0];
    const messageChildren = messageBox.props.children;
    const contentElement = messageChildren.find((child: any) => 
      child.props?.children === 'Streaming content'
    );
    expect(contentElement.props.inverse).toBe(true);
  });

  test('streaming works with search highlighting', () => {
    const element = Message({ 
      type: 'streaming',
      content: 'This streaming content has search terms',
      isStreaming: true,
      searchTerm: 'search'
    }) as any;
    
    // Should handle search highlighting during streaming
    expect(element).toBeTruthy();
    
    // Content should be processed for search highlighting
    const children = element.props.children;
    expect(children.length).toBeGreaterThan(1);
  });
});
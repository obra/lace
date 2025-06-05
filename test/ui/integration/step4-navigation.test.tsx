// ABOUTME: Integration tests for Step 4 navigation functionality
// ABOUTME: Tests navigation mode state management and component integration

import React from 'react';
import StatusBar from '../../../src/ui/components/StatusBar';
import InputBar from '../../../src/ui/components/InputBar';
import ConversationView from '../../../src/ui/components/ConversationView';

describe('Step 4: Navigation Mode Integration', () => {
  test('StatusBar displays navigation mode correctly', () => {
    const normalElement = StatusBar({ isNavigationMode: false }) as any;
    const navElement = StatusBar({ isNavigationMode: true, scrollPosition: 1, totalMessages: 4 }) as any;
    
    // Normal mode should show "Ready"
    const normalFragment = normalElement.props.children[2];
    const normalFragmentChildren = normalFragment.props.children;
    const readyElement = normalFragmentChildren.find((child: any) => 
      child.props.children === 'Ready'
    );
    expect(readyElement).toBeTruthy();
    
    // Navigation mode should show "Nav: j/k" and position
    const navFragment = navElement.props.children[2];
    const navFragmentChildren = navFragment.props.children;
    const navModeElement = navFragmentChildren.find((child: any) => 
      child.props.children === 'Nav: j/k'
    );
    expect(navModeElement).toBeTruthy();
    expect(navModeElement.props.color).toBe('yellow');
  });

  test('InputBar shows navigation mode message', () => {
    const normalElement = InputBar({ isNavigationMode: false }) as any;
    const navElement = InputBar({ isNavigationMode: true }) as any;
    
    // Normal mode shows placeholder in fragment
    const normalFragment = normalElement.props.children[1];
    const normalText = normalFragment.props.children[0]; // First child of fragment is placeholder
    expect(normalText.props.children).toBe('Type your message...');
    expect(normalText.props.color).toBe('dim');
    
    // Navigation mode shows instruction directly (not in fragment)
    const navText = navElement.props.children[1];
    expect(navText.props.children).toBe('Navigation mode - Press Escape to exit');
    expect(navText.props.color).toBe('yellow');
  });

  test('ConversationView highlights messages correctly', () => {
    const element = ConversationView({ scrollPosition: 2, isNavigationMode: true }) as any;
    const messages = element.props.children;
    
    // Should have 4 messages
    expect(messages).toHaveLength(4);
    
    // Third message (index 2) should be highlighted
    expect(messages[0].props.isHighlighted).toBe(false);
    expect(messages[1].props.isHighlighted).toBe(false);
    expect(messages[2].props.isHighlighted).toBe(true);
    expect(messages[3].props.isHighlighted).toBe(false);
  });

  test('navigation state affects all components correctly', () => {
    const scrollPosition = 1;
    const totalMessages = 4;
    const isNavigationMode = true;
    
    // Test that all components receive and handle navigation state properly
    const statusBar = StatusBar({ isNavigationMode, scrollPosition, totalMessages }) as any;
    const inputBar = InputBar({ isNavigationMode }) as any;
    const conversationView = ConversationView({ scrollPosition, isNavigationMode }) as any;
    
    // StatusBar should show navigation info
    const statusFragment = statusBar.props.children[2];
    const statusChildren = statusFragment.props.children;
    const positionElement = statusChildren.find((child: any) => 
      Array.isArray(child.props.children) && child.props.children[0] === 'Line '
    );
    expect(positionElement.props.children).toEqual(['Line ', 2, ' of ', 4]);
    
    // InputBar should show navigation message
    const inputText = inputBar.props.children[1];
    expect(inputText.props.color).toBe('yellow');
    
    // ConversationView should highlight correct message
    const messages = conversationView.props.children;
    expect(messages[1].props.isHighlighted).toBe(true);
  });
});
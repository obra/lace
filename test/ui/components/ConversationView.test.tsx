// ABOUTME: Unit tests for ConversationView component
// ABOUTME: Tests actual component behavior and layout properties

import React from 'react';
import ConversationView from '../../../src/ui/components/ConversationView';
import { Box, Text } from 'ink';

describe('ConversationView Component', () => {
  test('renders correct JSX structure with layout props', () => {
    const element = ConversationView({}) as any;
    
    // Should return a Box element with flexGrow and column direction
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe('column');
    expect(element.props.flexGrow).toBe(1);
    expect(element.props.padding).toBe(1);
    expect(React.isValidElement(element)).toBe(true);
  });

  test('displays placeholder message', () => {
    const element = ConversationView({}) as any;
    const children = element.props.children;
    
    // Find the placeholder text element
    const placeholderElement = children.find((child: any) => 
      child.type === Text && child.props.children.includes('Conversation will appear here')
    );
    
    expect(placeholderElement).toBeTruthy();
    expect(placeholderElement.props.color).toBe('dim');
  });

  test('displays ready message', () => {
    const element = ConversationView({}) as any;
    const children = element.props.children;
    
    // Find the ready text element
    const readyElement = children.find((child: any) => 
      child.type === Text && child.props.children.includes('Ready for messages and responses')
    );
    
    expect(readyElement).toBeTruthy();
    expect(readyElement.props.color).toBe('dim');
  });
});
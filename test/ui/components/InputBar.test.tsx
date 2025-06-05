// ABOUTME: Unit tests for InputBar component
// ABOUTME: Tests actual component behavior and content

import React from 'react';
import InputBar from '../../../src/ui/components/InputBar';
import { Box, Text } from 'ink';

describe('InputBar Component', () => {
  test('renders correct JSX structure', () => {
    const element = InputBar({}) as any;
    
    // Should return a Box element
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test('contains prompt text with cyan color', () => {
    const element = InputBar({}) as any;
    
    // Should have children array with Text elements
    const children = element.props.children;
    expect(children).toHaveLength(2);
    
    const [promptElement, placeholderElement] = children;
    
    // First child should be the prompt
    expect(promptElement.type).toBe(Text);
    expect(promptElement.props.color).toBe('cyan');
    expect(promptElement.props.children).toBe('> ');
  });

  test('contains placeholder text with dim color', () => {
    const element = InputBar({}) as any;
    const children = element.props.children;
    const [, fragmentElement] = children;
    
    // Second child is now a fragment containing the placeholder
    expect(fragmentElement.type).toBe(React.Fragment);
    
    // Fragment contains the placeholder text
    const fragmentChildren = fragmentElement.props.children;
    const placeholderElement = fragmentChildren[0]; // First child is placeholder when no input text
    
    expect(placeholderElement.type).toBe(Text);
    expect(placeholderElement.props.color).toBe('dim');
    expect(placeholderElement.props.children).toBe('Type your message...');
  });
});
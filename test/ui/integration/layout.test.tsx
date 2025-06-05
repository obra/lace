// ABOUTME: Integration tests for Step 2 layout structure
// ABOUTME: Tests complete App component assembly and layout

import React from 'react';
import App from '../../../src/ui/App';
import { Box } from 'ink';

describe('Step 2: Basic Layout Structure', () => {
  test('App renders correct layout structure', () => {
    const element = App({}) as any;
    
    // Should return a Box with column direction and full height
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe('column');
    expect(element.props.height).toBe('100%');
    expect(React.isValidElement(element)).toBe(true);
  });

  test('App contains all three main components in correct order', () => {
    const element = App({}) as any;
    const children = element.props.children;
    
    // Should have exactly 3 children
    expect(children).toHaveLength(3);
    
    // First child should be ConversationView component
    expect(children[0].type.name).toBe('ConversationView');
    
    // Second child should be StatusBar component  
    expect(children[1].type.name).toBe('StatusBar');
    
    // Third child should be InputBar component
    expect(children[2].type.name).toBe('InputBar');
  });

  test('App properly composes all components', () => {
    const element = App({}) as any;
    
    // Test that the app successfully renders without crashing
    expect(element).toBeTruthy();
    expect(React.isValidElement(element)).toBe(true);
    
    // Test that the structure is what we expect
    const children = element.props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children.length).toBe(3);
  });
});
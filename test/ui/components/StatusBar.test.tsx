// ABOUTME: Unit tests for StatusBar component
// ABOUTME: Tests actual component behavior and content

import React from 'react';
import StatusBar from '../../../src/ui/components/StatusBar';
import { Box, Text } from 'ink';

describe('StatusBar Component', () => {
  test('renders correct JSX structure with border', () => {
    const element = StatusBar({}) as any;
    
    // Should return a Box element with border styling
    expect(element.type).toBe(Box);
    expect(element.props.borderStyle).toBe('single');
    expect(element.props.borderTop).toBe(true);
    expect(element.props.borderBottom).toBe(false);
    expect(element.props.borderLeft).toBe(false);
    expect(element.props.borderRight).toBe(false);
    expect(React.isValidElement(element)).toBe(true);
  });

  test('displays app name with correct styling', () => {
    const element = StatusBar({}) as any;
    const children = element.props.children;
    
    // Find the "lace-ink" text element
    const appNameElement = children.find((child: any) => 
      child.type === Text && child.props.children === 'lace-ink'
    );
    
    expect(appNameElement).toBeTruthy();
    expect(appNameElement.props.color).toBe('cyan');
  });

  test('displays status with correct styling', () => {
    const element = StatusBar({}) as any;
    const children = element.props.children;
    
    // Find the "Ready" text element
    const statusElement = children.find((child: any) => 
      child.type === Text && child.props.children === 'Ready'
    );
    
    expect(statusElement).toBeTruthy();
    expect(statusElement.props.color).toBe('green');
  });

  test('displays navigation hint', () => {
    const element = StatusBar({}) as any;
    const children = element.props.children;
    
    // Find the navigation hint text element
    const navElement = children.find((child: any) => 
      child.type === Text && child.props.children === '↑/↓ to navigate'
    );
    
    expect(navElement).toBeTruthy();
    expect(navElement.props.color).toBe('dim');
  });
});
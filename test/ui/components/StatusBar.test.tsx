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

  test('displays status with correct styling in normal mode', () => {
    const element = StatusBar({ isNavigationMode: false }) as any;
    const children = element.props.children;
    
    // The third child is the fragment containing Ready and navigation hint
    const fragment = children[2];
    const fragmentChildren = fragment.props.children;
    
    // Find the "Ready" text element
    const statusElement = fragmentChildren.find((child: any) => 
      child.type === Text && child.props.children === 'Ready'
    );
    
    expect(statusElement).toBeTruthy();
    expect(statusElement.props.color).toBe('green');
  });

  test('displays navigation hint in normal mode', () => {
    const element = StatusBar({ isNavigationMode: false }) as any;
    const children = element.props.children;
    
    // The third child is the fragment containing Ready and navigation hint
    const fragment = children[2];
    const fragmentChildren = fragment.props.children;
    
    // Find the navigation hint text element
    const navElement = fragmentChildren.find((child: any) => 
      child.type === Text && child.props.children === '↑/↓ to navigate'
    );
    
    expect(navElement).toBeTruthy();
    expect(navElement.props.color).toBe('dim');
  });

  test('displays navigation mode with position when in nav mode', () => {
    const element = StatusBar({ isNavigationMode: true, scrollPosition: 2, totalMessages: 4 }) as any;
    const children = element.props.children;
    
    // The third child is the fragment containing Nav mode info
    const fragment = children[2];
    const fragmentChildren = fragment.props.children;
    
    // Find the "Nav: j/k" text element
    const navModeElement = fragmentChildren.find((child: any) => 
      child.type === Text && child.props.children === 'Nav: j/k'
    );
    
    expect(navModeElement).toBeTruthy();
    expect(navModeElement.props.color).toBe('yellow');
    
    // Find the position text element - it's an array: ["Line ", 3, " of ", 4]
    const positionElement = fragmentChildren.find((child: any) => 
      child.type === Text && Array.isArray(child.props.children) && 
      child.props.children[0] === 'Line '
    );
    
    expect(positionElement).toBeTruthy();
    expect(positionElement.props.color).toBe('dim');
    expect(positionElement.props.children).toEqual(['Line ', 3, ' of ', 4]);
  });
});
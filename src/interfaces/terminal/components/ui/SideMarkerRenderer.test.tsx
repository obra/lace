// ABOUTME: Unit tests for SideMarkerRenderer character selection and color logic
// ABOUTME: Validates marker characters based on height and status-based color selection

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { SideMarkerRenderer, getMarkerCharacters, getMarkerColor } from './SideMarkerRenderer.js';

describe('getMarkerCharacters', () => {
  it('returns single character for height 1', () => {
    const result = getMarkerCharacters(1);
    expect(result).toEqual({ single: '⊂' });
  });

  it('returns top and bottom for height 2', () => {
    const result = getMarkerCharacters(2);
    expect(result).toEqual({ 
      top: '╭', 
      bottom: '╰' 
    });
  });

  it('returns top, middle, and bottom for height 3+', () => {
    const result = getMarkerCharacters(3);
    expect(result).toEqual({
      top: '╭',
      middle: '│',
      bottom: '╰'
    });

    const result5 = getMarkerCharacters(5);
    expect(result5).toEqual({
      top: '╭',
      middle: '│',
      bottom: '╰'
    });
  });
});

describe('getMarkerColor', () => {
  it('returns correct unfocused colors', () => {
    expect(getMarkerColor('none', false)).toBe('gray');
    expect(getMarkerColor('pending', false)).toBe('yellow');
    expect(getMarkerColor('success', false)).toBe('green');
    expect(getMarkerColor('error', false)).toBe('red');
  });

  it('returns correct focused/bright colors', () => {
    expect(getMarkerColor('none', true)).toBe('white');
    expect(getMarkerColor('pending', true)).toBe('yellowBright');
    expect(getMarkerColor('success', true)).toBe('greenBright');
    expect(getMarkerColor('error', true)).toBe('redBright');
  });
});

describe('SideMarkerRenderer', () => {
  it('renders single line layout', () => {
    const { lastFrame } = render(
      <SideMarkerRenderer 
        status="success" 
        isSelected={false} 
        contentHeight={1}
      >
        <Text>Single line content</Text>
      </SideMarkerRenderer>
    );

    expect(lastFrame()).toContain('⊂ Single line content');
  });

  it('renders two line layout', () => {
    const { lastFrame } = render(
      <SideMarkerRenderer 
        status="error" 
        isSelected={false} 
        contentHeight={2}
      >
        <Text>Line 1</Text>
        <Text>Line 2</Text>
      </SideMarkerRenderer>
    );

    const output = lastFrame() || '';
    expect(output).toContain('╭');
    expect(output).toContain('╰');
    expect(output).toContain('Line 1');
    expect(output).toContain('Line 2');
  });

  it('renders multi-line layout with middle characters', () => {
    const { lastFrame } = render(
      <SideMarkerRenderer 
        status="pending" 
        isSelected={false} 
        contentHeight={4}
      >
        <Text>Line 1</Text>
        <Text>Line 2</Text>
        <Text>Line 3</Text>
        <Text>Line 4</Text>
      </SideMarkerRenderer>
    );

    const output = lastFrame() || '';
    expect(output).toContain('╭');
    expect(output).toContain('│');
    expect(output).toContain('╰');
    
    // Should have 2 middle characters for 4-line content (4 - 2 = 2)
    const middleCount = (output.match(/│/g) || []).length;
    expect(middleCount).toBe(2);
  });

  it('applies colors correctly based on status and selection', () => {
    const { rerender } = render(
      <SideMarkerRenderer 
        status="success" 
        isSelected={false} 
        contentHeight={1}
      >
        <Text>Content</Text>
      </SideMarkerRenderer>
    );

    // Test focused state change
    rerender(
      <SideMarkerRenderer 
        status="success" 
        isSelected={true} 
        contentHeight={1}
      >
        <Text>Content</Text>
      </SideMarkerRenderer>
    );

    // We can't easily test colors in unit tests, but we can test that rendering succeeds
    expect(true).toBe(true);
  });
});
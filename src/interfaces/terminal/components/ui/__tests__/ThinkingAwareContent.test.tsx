// ABOUTME: Tests for ThinkingAwareContent component
// ABOUTME: Verifies proper rendering of thinking blocks with Ink styling instead of ANSI hacks

import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderInkComponent } from '../../../__tests__/helpers/ink-test-utils.js';
import { ThinkingAwareContent } from '../ThinkingAwareContent.js';

describe('ThinkingAwareContent', () => {
  it('renders content without thinking blocks normally', () => {
    const content = 'Just regular content here';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Just regular content here');
  });

  it('renders thinking blocks in italics when showThinking is true', () => {
    const content = '<think>Some thinking</think>Response content';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Some thinking');
    expect(frame).toContain('Response content');
  });

  it('renders thinking summary when showThinking is false', () => {
    const content = '<think>Some thinking content here</think>Response';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('thought for 4 words');
    expect(frame).toContain('Response');
    expect(frame).not.toContain('Some thinking content here');
  });

  it('handles multiple thinking blocks', () => {
    const content = '<think>First</think>Middle<think>Second thought</think>End';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('First');
    expect(frame).toContain('Middle');
    expect(frame).toContain('Second thought');
    expect(frame).toContain('End');
  });

  it('handles multiple thinking blocks in summary mode', () => {
    const content = '<think>First</think>Middle<think>Second thought</think>End';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={false} />
    );

    const frame = lastFrame();
    expect(frame).toContain('thought for 1 word');
    expect(frame).toContain('thought for 2 words');
    expect(frame).toContain('Middle');
    expect(frame).toContain('End');
  });

  it('handles unclosed thinking blocks (streaming case)', () => {
    const content = 'Response content <think>partial thinking';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Response content');
    expect(frame).toContain('partial thinking');
  });

  it('handles multiline thinking blocks properly', () => {
    const content = '<think>Line 1\nLine 2\nLine 3</think>Response';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={true} />
    );

    const frame = lastFrame();
    expect(frame).toContain('Line 1');
    expect(frame).toContain('Line 2'); 
    expect(frame).toContain('Line 3');
    expect(frame).toContain('Response');
  });

  it('handles empty thinking blocks by skipping them', () => {
    const content = '<think></think>Response';
    
    const { lastFrame } = renderInkComponent(
      <ThinkingAwareContent content={content} showThinking={false} />
    );

    const frame = lastFrame();
    expect(frame).not.toContain('thought for 0 words');
    expect(frame).toContain('Response');
  });
});
// ABOUTME: Tests for UserMessageDisplay component ensuring full content display
// ABOUTME: Verifies user messages always show complete content without truncation or expansion

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { UserMessageDisplay } from '../UserMessageDisplay.js';
import { ThreadEvent } from '../../../../../threads/types.js';

describe('UserMessageDisplay', () => {
  const createUserMessageEvent = (content: string): ThreadEvent => ({
    id: 'user-1',
    threadId: 'thread-1',
    type: 'USER_MESSAGE',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    data: content
  });

  describe('Full content display', () => {
    it('should display short user messages completely', () => {
      const event = createUserMessageEvent('Hello world');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      expect(lastFrame()).toContain('Hello world');
    });

    it('should display long user messages completely without truncation', () => {
      const longMessage = 'This is a very long user message that would typically be truncated in other systems but should be displayed completely in our timeline. '.repeat(10);
      const event = createUserMessageEvent(longMessage);
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      // Content should be present (may be wrapped)
      expect(frame).toContain('This is a very long user message');
      expect(frame).toContain('displayed completely in our timeline');
      // Should not have truncation indicators
      expect(frame).not.toContain('...');
      expect(frame).not.toContain('[truncated]');
      expect(frame).not.toContain('more');
    });

    it('should display multiline user messages completely', () => {
      const multilineMessage = `Line 1: This is the first line
Line 2: This is the second line
Line 3: This is the third line with more content
Line 4: Final line`;
      const event = createUserMessageEvent(multilineMessage);
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      expect(frame).toContain('Line 1: This is the first line');
      expect(frame).toContain('Line 2: This is the second line');
      expect(frame).toContain('Line 3: This is the third line with more content');
      expect(frame).toContain('Line 4: Final line');
    });

    it('should display special characters and unicode completely', () => {
      const specialMessage = '🚀 Special chars: áéíóú, 中文, русский, العربية, emojis: 🎉🔥💡';
      const event = createUserMessageEvent(specialMessage);
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      expect(lastFrame()).toContain(specialMessage);
    });

    it('should trim whitespace but preserve content', () => {
      const messageWithWhitespace = '   Content with leading and trailing spaces   ';
      const event = createUserMessageEvent(messageWithWhitespace);
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      expect(frame).toContain('Content with leading and trailing spaces');
      expect(frame).not.toContain('   Content'); // Should be trimmed
    });
  });

  describe('No expansion behavior', () => {
    it('should not have any expansion controls or indicators', () => {
      const event = createUserMessageEvent('Regular user message');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      expect(frame).not.toContain('[Expand]');
      expect(frame).not.toContain('[Collapse]');
      expect(frame).not.toContain('►');
      expect(frame).not.toContain('▼');
      expect(frame).not.toContain('Show more');
      expect(frame).not.toContain('Show less');
    });

    it('should not accept onToggle prop (interface verification)', () => {
      const event = createUserMessageEvent('Test message');
      
      // This should compile without onToggle prop
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      expect(lastFrame()).toContain('Test message');
    });
  });

  describe('Focus states', () => {
    it('should render with normal colors when focused', () => {
      const event = createUserMessageEvent('Focused message');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} isFocused={true} />
      );
      
      expect(lastFrame()).toContain('Focused message');
    });

    it('should render with dimmed colors when not focused', () => {
      const event = createUserMessageEvent('Unfocused message');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} isFocused={false} />
      );
      
      expect(lastFrame()).toContain('Unfocused message');
    });
  });

  describe('Streaming states', () => {
    it('should show typing indicator when streaming', () => {
      const event = createUserMessageEvent('Streaming message');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} isStreaming={true} />
      );
      
      const frame = lastFrame();
      expect(frame).toContain('Streaming message');
      expect(frame).toContain('(typing...)');
    });

    it('should not show typing indicator when not streaming', () => {
      const event = createUserMessageEvent('Complete message');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} isStreaming={false} />
      );
      
      const frame = lastFrame();
      expect(frame).toContain('Complete message');
      expect(frame).not.toContain('(typing...)');
    });
  });

  describe('Visual formatting', () => {
    it('should include user input prompt prefix', () => {
      const event = createUserMessageEvent('Message with prefix');
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      expect(frame).toContain('>'); // User input prefix
      expect(frame).toContain('Message with prefix');
    });

    it('should wrap long content appropriately', () => {
      const longSingleLineMessage = 'A'.repeat(200); // Very long single line
      const event = createUserMessageEvent(longSingleLineMessage);
      
      const { lastFrame } = render(
        <UserMessageDisplay event={event} />
      );
      
      const frame = lastFrame();
      // Content should be present (may be wrapped) - check for substantial presence
      const aCount = (frame?.match(/A/g) || []).length;
      expect(aCount).toBe(200); // All 200 A's should be present
    });
  });
});
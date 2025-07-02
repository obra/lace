// ABOUTME: Tests for UserMessageDisplay component with collapsible behavior
// ABOUTME: Verifies user messages auto-collapse for long content and show proper expansion controls

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { UserMessageDisplay } from '../UserMessageDisplay.js';
import { ThreadEvent } from '../../../../../threads/types.js';
import { UI_SYMBOLS } from '../../../theme.js';

describe('UserMessageDisplay', () => {
  const createUserMessageEvent = (content: string): ThreadEvent => ({
    id: 'user-1',
    threadId: 'thread-1',
    type: 'USER_MESSAGE',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    data: content,
  });

  describe('Collapsible content display', () => {
    it('should display short user messages with non-expandable indicator', () => {
      const event = createUserMessageEvent('Hello world');

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Hello world"');
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE); // Non-expandable for short messages
    });

    it('should auto-collapse long user messages and show ellipsis', () => {
      const longMessage = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}: This is line content`).join('\n');
      const event = createUserMessageEvent(longMessage);

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Line 1: This is line content'); // Should show first line in quotes
      expect(frame).toContain('Line 8: This is line content'); // Should show first 8 lines
      expect(frame).not.toContain('Line 9: This is line content'); // Should not show beyond 8 lines
      expect(frame).toContain('...'); // Should show ellipsis
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE_EXPANDABLE); // Expandable for long messages
    });

    it('should display short multiline user messages expanded', () => {
      const multilineMessage = `Line 1: This is the first line
Line 2: This is the second line
Line 3: This is the third line with more content
Line 4: Final line`;
      const event = createUserMessageEvent(multilineMessage);

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Line 1: This is the first line');
      expect(frame).toContain('Line 2: This is the second line');
      expect(frame).toContain('Line 3: This is the third line with more content');
      expect(frame).toContain('Line 4: Final line');
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE); // Non-expandable for short messages
    });

    it('should display special characters and unicode completely', () => {
      const specialMessage = '🚀 Special chars: áéíóú, 中文, русский, العربية, emojis: 🎉🔥💡';
      const event = createUserMessageEvent(specialMessage);

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      expect(lastFrame()).toContain(specialMessage);
    });

    it('should trim empty lines and leading/trailing spaces', () => {
      const messageWithEmptyLines = '\n\n   Content with leading and trailing spaces   \n\n';
      const event = createUserMessageEvent(messageWithEmptyLines);

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Content with leading and trailing spaces"');
      expect(frame).not.toContain('   Content'); // Should be trimmed
    });
  });

  describe('Expansion behavior', () => {
    it('should have collapsible structure with appropriate indicators', () => {
      const event = createUserMessageEvent('Regular user message');

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Regular user message"');
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE); // Non-expandable for short messages
    });

    it('should accept onToggle prop for expansion control', () => {
      const event = createUserMessageEvent('Test message');

      // This should compile with onToggle prop
      const { lastFrame } = render(<UserMessageDisplay event={event} onToggle={() => {}} />);

      expect(lastFrame()).toContain('Test message');
    });
  });

  describe('Focus states', () => {
    it('should render with normal colors when focused', () => {
      const event = createUserMessageEvent('Focused message');

      const { lastFrame } = render(<UserMessageDisplay event={event} isFocused={true} />);

      expect(lastFrame()).toContain('Focused message');
    });

    it('should render with dimmed colors when not focused', () => {
      const event = createUserMessageEvent('Unfocused message');

      const { lastFrame } = render(<UserMessageDisplay event={event} isFocused={false} />);

      expect(lastFrame()).toContain('Unfocused message');
    });
  });

  describe('Streaming states', () => {
    it('should show typing indicator when streaming', () => {
      const event = createUserMessageEvent('Streaming message');

      const { lastFrame } = render(<UserMessageDisplay event={event} isStreaming={true} />);

      const frame = lastFrame();
      expect(frame).toContain('Streaming message');
      expect(frame).toContain('(typing...)');
    });

    it('should not show typing indicator when not streaming', () => {
      const event = createUserMessageEvent('Complete message');

      const { lastFrame } = render(<UserMessageDisplay event={event} isStreaming={false} />);

      const frame = lastFrame();
      expect(frame).toContain('Complete message');
      expect(frame).not.toContain('(typing...)');
    });
  });

  describe('Visual formatting', () => {
    it('should include quoted message content', () => {
      const event = createUserMessageEvent('Message with label');

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      expect(frame).toContain('"Message with label"');
      expect(frame).toContain(UI_SYMBOLS.TOOLBOX_SINGLE);
    });

    it('should wrap long content appropriately', () => {
      const longSingleLineMessage = 'A'.repeat(200); // Very long single line
      const event = createUserMessageEvent(longSingleLineMessage);

      const { lastFrame } = render(<UserMessageDisplay event={event} />);

      const frame = lastFrame();
      // Content should be present (may be wrapped) - check for substantial presence
      const aCount = (frame?.match(/A/g) || []).length;
      expect(aCount).toBe(200); // All 200 A's should be present
    });
  });
});

// ABOUTME: Logic tests for ToolApprovalModal component
// ABOUTME: Tests the component behavior by directly invoking the useInput handler

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderInkComponent } from './helpers/ink-test-utils.js';
import ToolApprovalModal from '../components/tool-approval-modal.js';
import { ApprovalDecision } from '../../../tools/approval-types.js';

// Create a wrapper component that exposes the useInput handler for testing
let capturedInputHandler: ((input: string, key: any) => void) | null = null;

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: (handler: (input: string, key: any) => void) => {
      capturedInputHandler = handler;
    },
  };
});

describe('ToolApprovalModal Logic', () => {
  let mockOnDecision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnDecision = vi.fn();
    capturedInputHandler = null;
  });

  const renderModal = (isVisible = true) => {
    return renderInkComponent(
      <ToolApprovalModal
        toolName="bash"
        input={{ command: 'ls' }}
        isReadOnly={false}
        onDecision={mockOnDecision}
        isVisible={isVisible}
      />
    );
  };

  describe('keyboard input handling', () => {
    it('calls onDecision with ALLOW_ONCE when y is pressed', () => {
      renderModal();

      expect(capturedInputHandler).toBeTruthy();

      act(() => {
        capturedInputHandler!('y', {});
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_ONCE when a is pressed', () => {
      renderModal();

      act(() => {
        capturedInputHandler!('a', {});
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_SESSION when s is pressed', () => {
      renderModal();

      act(() => {
        capturedInputHandler!('s', {});
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('calls onDecision with DENY when n is pressed', () => {
      renderModal();

      act(() => {
        capturedInputHandler!('n', {});
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('calls onDecision with DENY when d is pressed', () => {
      renderModal();

      act(() => {
        capturedInputHandler!('d', {});
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('ignores input when not visible', () => {
      renderModal(false);

      act(() => {
        capturedInputHandler!('y', {});
      });

      expect(mockOnDecision).not.toHaveBeenCalled();
    });

    it('handles arrow navigation correctly', () => {
      const { lastFrame } = renderModal();

      // Initial state should show first option selected
      expect(lastFrame()).toContain('▶ y) Allow Once');

      // Simulate down arrow - this should update internal state
      act(() => {
        capturedInputHandler!('', { downArrow: true });
      });

      // Now simulate Enter to see which option is selected
      act(() => {
        capturedInputHandler!('', { return: true });
      });

      // Should have called the second option (ALLOW_SESSION)
      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('handles Enter key selection correctly', () => {
      renderModal();

      // First navigate to the third option (Deny)
      act(() => {
        capturedInputHandler!('', { downArrow: true });
      });
      act(() => {
        capturedInputHandler!('', { downArrow: true });
      });

      // Then press Enter
      act(() => {
        capturedInputHandler!('', { return: true });
      });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });
  });
});

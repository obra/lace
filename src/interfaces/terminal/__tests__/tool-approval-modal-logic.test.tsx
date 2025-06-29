// ABOUTME: Logic tests for ToolApprovalModal component
// ABOUTME: Tests the component behavior by directly invoking the useInput handler

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderInkComponentWithFocus } from './helpers/ink-test-utils.js';
import ToolApprovalModal from '../components/tool-approval-modal.js';
import { ApprovalDecision } from '../../../tools/approval-types.js';

// Capture the useInput handler for direct testing
let capturedInputHandlers: ((input: string, key: any) => void)[] = [];

vi.mock('ink', async () => {
  const actual = await vi.importActual('ink');
  return {
    ...actual,
    useInput: (handler: (input: string, key: any) => void, options?: { isActive?: boolean }) => {
      // Only capture handlers that are active (or don't specify isActive)
      if (options?.isActive !== false) {
        capturedInputHandlers.push(handler);
      }
    },
  };
});

// Mock the focus system to ensure the modal is focused in tests
vi.mock('../focus/index.js', async () => {
  const actual = await vi.importActual('../focus/index.js');
  return {
    ...actual,
    useLaceFocus: vi.fn(() => ({ isFocused: true, takeFocus: vi.fn() })),
    ModalWrapper: ({ children, isOpen }: any) => isOpen ? children : null,
  };
});

// Helper function to simulate keyboard input by calling all handlers
const simulateKeyPress = (input: string, key: any = {}) => {
  if (capturedInputHandlers.length > 0) {
    act(() => {
      // Call all captured handlers
      capturedInputHandlers.forEach(handler => handler(input, key));
    });
  }
};

describe('ToolApprovalModal Logic', () => {
  let mockOnDecision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnDecision = vi.fn();
    capturedInputHandlers = [];
    vi.clearAllMocks();
  });

  const renderModal = (isVisible = true) => {
    return renderInkComponentWithFocus(
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
    it('calls onDecision with ALLOW_ONCE when a is pressed', () => {
      renderModal();
      
      expect(capturedInputHandlers.length).toBeGreaterThan(0);

      simulateKeyPress('a');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_ONCE when y is pressed', () => {
      renderModal();

      simulateKeyPress('y');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_SESSION when s is pressed', () => {
      renderModal();

      simulateKeyPress('s');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('calls onDecision with DENY when n is pressed', () => {
      renderModal();

      simulateKeyPress('n');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('calls onDecision with DENY when d is pressed', () => {
      renderModal();

      simulateKeyPress('d');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('ignores input when not visible', () => {
      renderModal(false);

      simulateKeyPress('y');

      expect(mockOnDecision).not.toHaveBeenCalled();
    });

    it('handles arrow navigation correctly', () => {
      const { lastFrame } = renderModal();

      // Initial state should show first option selected
      expect(lastFrame()).toContain('▶ y) Allow Once');

      // Simulate down arrow - this should update internal state
      simulateKeyPress('', { downArrow: true });

      // Now simulate Enter to see which option is selected
      simulateKeyPress('', { return: true });

      // Should have called the second option (ALLOW_SESSION)
      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('handles Enter key selection correctly', () => {
      renderModal();

      // First navigate to the third option (Deny)
      simulateKeyPress('', { downArrow: true });
      simulateKeyPress('', { downArrow: true });

      // Then press Enter
      simulateKeyPress('', { return: true });

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });
  });
});

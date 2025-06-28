// ABOUTME: Tests for ToolApprovalModal component
// ABOUTME: Verifies visual tool approval functionality and user interactions

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderInkComponent, stripAnsi } from './helpers/ink-test-utils.js';
import ToolApprovalModal from '../components/tool-approval-modal.js';
import { ApprovalDecision } from '../../../tools/approval-types.js';

// Capture the useInput handler for direct testing
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

// Helper function to simulate keyboard input by calling the handler directly
const simulateKeyPress = (input: string, key: any = {}) => {
  if (capturedInputHandler) {
    act(() => {
      capturedInputHandler!(input, key);
    });
  }
};

describe('ToolApprovalModal', () => {
  let mockOnDecision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnDecision = vi.fn();
    capturedInputHandler = null;
    // Clear any React state by forcing unmount/remount
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders minimal output when not visible', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls -la' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={false}
        />
      );

      const frame = lastFrame();
      const cleanFrame = stripAnsi(frame || '').trim();
      // When not visible, should not contain modal content
      expect(cleanFrame).not.toContain('TOOL APPROVAL REQUEST');
      expect(cleanFrame).not.toContain('Tool: bash');
    });

    it('renders modal when visible', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls -la' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('TOOL APPROVAL REQUEST');
      expect(frame).toContain('Tool: bash');
      expect(frame).toContain('DESTRUCTIVE');
    });
  });

  describe('tool information display', () => {
    it('shows read-only tool correctly', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="read"
          input={{ file: 'test.txt' }}
          isReadOnly={true}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Tool: read');
      expect(lastFrame()).toContain('READ-ONLY');
    });

    it('shows destructive tool correctly', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'rm -rf /' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Tool: bash');
      expect(lastFrame()).toContain('DESTRUCTIVE');
    });

    it('formats simple input parameters', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'echo hello' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Parameters:');
      expect(lastFrame()).toContain('command: "echo hello"');
    });

    it('truncates long input parameters', () => {
      const longCommand = 'a'.repeat(200);
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: longCommand }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Parameters:');
      expect(lastFrame()).toContain('...');
      expect(lastFrame()).not.toContain(longCommand);
    });

    it('formats complex input parameters', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="tool"
          input={{
            files: ['file1.txt', 'file2.txt'],
            options: { recursive: true, force: false },
          }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Parameters:');
      expect(lastFrame()).toContain('files: ["file1.txt", "file2.txt"]');
      expect(lastFrame()).toContain('options: { recursive: true, force: false }');
    });
  });

  describe('options display', () => {
    it('shows all approval options', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('y) Allow Once');
      expect(lastFrame()).toContain('s) Allow Session');
      expect(lastFrame()).toContain('n) Deny');
    });

    it('shows help text', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      expect(lastFrame()).toContain('Keys: y/a=allow once, s=session, n/d=deny');
    });
  });

  describe('keyboard interactions', () => {
    it('calls onDecision with ALLOW_ONCE when y is pressed', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      simulateKeyPress('y');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_ONCE when a is pressed', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      simulateKeyPress('a');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_ONCE);
    });

    it('calls onDecision with ALLOW_SESSION when s is pressed', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      simulateKeyPress('s');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('calls onDecision with DENY when n is pressed', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'rm file' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      simulateKeyPress('n');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('calls onDecision with DENY when d is pressed', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'rm file' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      simulateKeyPress('d');

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.DENY);
    });

    it('navigates options with arrow keys', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      // Initial state should highlight first option
      expect(lastFrame()).toContain('▶ y) Allow Once');

      simulateKeyPress('', { downArrow: true }); // Down arrow

      expect(lastFrame()).toContain('▶ s) Allow Session');

      simulateKeyPress('', { downArrow: true }); // Down arrow again

      expect(lastFrame()).toContain('▶ n) Deny');
    });

    it('selects highlighted option with Enter', () => {
      // Reset handler to ensure clean state
      capturedInputHandler = null;

      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          key="enter-test" // Force new component instance
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      // Verify we start at first option
      expect(lastFrame()).toContain('▶ y) Allow Once');

      // Navigate to second option
      simulateKeyPress('', { downArrow: true }); // Down arrow

      // Verify we moved to second option
      expect(lastFrame()).toContain('▶ s) Allow Session');

      // Press Enter to select
      simulateKeyPress('', { return: true }); // Enter key

      expect(mockOnDecision).toHaveBeenCalledWith(ApprovalDecision.ALLOW_SESSION);
    });

    it('ignores input when not visible', () => {
      renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={false}
        />
      );

      simulateKeyPress('y');

      expect(mockOnDecision).not.toHaveBeenCalled();
    });
  });

  describe('state management', () => {
    it('resets selection when becoming visible', async () => {
      const { lastFrame, rerender } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      // Navigate to second option
      simulateKeyPress('', { downArrow: true }); // Down arrow

      expect(lastFrame()).toContain('▶ s) Allow Session');

      // Hide and show again
      rerender(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={false}
        />
      );

      rerender(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: 'ls' }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      // Wait for effect to process
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should be back to first option
      expect(lastFrame()).toContain('▶ y) Allow Once');
    });
  });
});

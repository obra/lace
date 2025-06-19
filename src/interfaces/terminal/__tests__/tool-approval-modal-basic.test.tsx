// ABOUTME: Basic tests for ToolApprovalModal component focusing on rendering
// ABOUTME: Tests visual display and basic functionality without complex keyboard interactions

import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderInkComponent, stripAnsi } from './helpers/ink-test-utils.js';
import ToolApprovalModal from '../components/tool-approval-modal.js';
import { ApprovalDecision } from '../../../tools/approval-types.js';

describe('ToolApprovalModal Basic', () => {
  let mockOnDecision: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnDecision = vi.fn();
  });

  describe('visibility', () => {
    it('renders modal when visible', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: "ls -la" }}
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
          input={{ file: "test.txt" }}
          isReadOnly={true}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Tool: read');
      expect(frame).toContain('READ-ONLY');
    });

    it('shows destructive tool correctly', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: "rm -rf /" }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Tool: bash');
      expect(frame).toContain('DESTRUCTIVE');
    });

    it('formats simple input parameters', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: "echo hello" }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Parameters:');
      expect(frame).toContain('command: "echo hello"');
    });
  });

  describe('options display', () => {
    it('shows all approval options', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: "ls" }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('y) Allow Once');
      expect(frame).toContain('s) Allow Session');
      expect(frame).toContain('n) Deny');
    });

    it('shows help text', () => {
      const { lastFrame } = renderInkComponent(
        <ToolApprovalModal
          toolName="bash"
          input={{ command: "ls" }}
          isReadOnly={false}
          onDecision={mockOnDecision}
          isVisible={true}
        />
      );

      const frame = lastFrame();
      expect(frame).toContain('Keys: y/a=allow once, s=session, n/d=deny');
    });
  });
});
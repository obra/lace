// ABOUTME: Unit tests for ToolApprovalModal component
// ABOUTME: Tests tool approval component structure and behavior

import { jest, describe, test, beforeEach, expect } from "@jest/globals";
import React from "react";
import { render } from "ink-testing-library";
import ToolApprovalModal from "@/ui/components/ToolApprovalModal";
import { Box, Text } from "ink";

// Mock Ink hooks that require terminal environment
jest.mock("ink", () => {
  const actualInk = jest.requireActual("ink") as any;
  return {
    ...actualInk,
    useFocus: jest.fn(() => ({ isFocused: false })),
    useInput: jest.fn()
  };
});

// Mock useRef since it causes issues in unit test environment
jest.mock("react", () => {
  const actualReact = jest.requireActual("react") as any;
  return {
    ...actualReact,
    useRef: jest.fn(() => ({ current: "test-id" })),
    useState: jest.fn((initial) => [initial, jest.fn()])
  };
});

describe("ToolApprovalModal Component", () => {
  const mockToolCall = {
    name: "file_write",
    input: {
      path: "/test/file.txt",
      content: "test content"
    },
    description: "Write content to a file"
  };

  const defaultProps = {
    toolCall: mockToolCall,
    riskLevel: "medium" as const,
    context: {
      reasoning: "User requested to save the file"
    },
    onApprove: jest.fn(),
    onDeny: jest.fn(),
    onStop: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("user can see tool approval modal structure", () => {
    const { lastFrame } = render(<ToolApprovalModal {...defaultProps} />);
    const output = lastFrame();

    // Should display the essential information to the user
    expect(output).toContain("Tool Approval Required");
    expect(output).toContain("HIGH");
    expect(output).toContain("execute_command");
  });

  test("user can see modal renders with tool information", () => {
    const { lastFrame } = render(<ToolApprovalModal {...defaultProps} />);
    const output = lastFrame();
    
    // Should display tool information
    expect(output).toContain("execute_command");
    expect(output).toContain("test input");
    expect(output).toContain("Tool Approval Required");
  });

  test("user can see modal with different risk levels", () => {
    const riskLevels = ["low", "medium", "high"] as const;
    
    riskLevels.forEach(riskLevel => {
      const { lastFrame } = render(<ToolApprovalModal {...defaultProps} riskLevel={riskLevel} />);
      const output = lastFrame();
      
      // Should render successfully for all risk levels
      expect(output).toContain("Tool Approval Required");
      expect(output).toContain(riskLevel.toUpperCase());
    });
  });

  test("user can see modal without optional properties", () => {
    const minimalProps = {
      toolCall: {
        name: "test_tool",
        input: { param: "value" }
        // No description
      },
      riskLevel: "low" as const,
      // No context
      onApprove: jest.fn(),
      onDeny: jest.fn(),
      onStop: jest.fn()
    };

    const { lastFrame } = render(<ToolApprovalModal {...minimalProps} />);
    const output = lastFrame();
    
    // Should render successfully without optional props
    expect(output).toContain("Tool Approval Required");
    expect(output).toContain("test_tool");
  });

  test("user can see modal with complex tool parameters", () => {
    const complexToolCall = {
      name: "api_call",
      input: {
        url: "https://api.example.com",
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          data: ["item1", "item2"],
          metadata: { timestamp: 1234567890 }
        }
      }
    };

    const { lastFrame } = render(<ToolApprovalModal {...defaultProps} toolCall={complexToolCall} />);
    const output = lastFrame();
    
    // Should handle complex parameters without error
    expect(output).toContain("Tool Approval Required");
    expect(output).toContain("api_call");
  });

  test("user can see modal with empty parameters", () => {
    const emptyParamsToolCall = {
      name: "status_check",
      input: {}
    };

    const { lastFrame } = render(<ToolApprovalModal {...defaultProps} toolCall={emptyParamsToolCall} />);
    const output = lastFrame();
    
    // Should handle empty parameters
    expect(output).toContain("Tool Approval Required");
    expect(output).toContain("status_check");
  });
});
// ABOUTME: Unit tests for ToolApprovalModal component
// ABOUTME: Tests tool approval component structure and behavior

import { jest, describe, test, beforeEach, expect } from "@jest/globals";
import React from "react";
import { renderInkComponent } from "../helpers/ink-test-utils";
import ToolApprovalModal from "@/ui/components/ToolApprovalModal";
import { Box, Text } from "ink";
import { createMockToolCall } from "../__mocks__/standard-mocks.js";

describe("ToolApprovalModal Component", () => {
  const mockToolCall = createMockToolCall();

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
    const { lastFrame } = renderInkComponent(<ToolApprovalModal {...defaultProps} />);
    const output = lastFrame();

    // Should display the essential information to the user
    expect(output).toContain("Tool Execution Request");
    expect(output).toContain("MEDIUM");
    expect(output).toContain("file_write");
  });

  test("user can see modal renders with tool information", () => {
    const { lastFrame } = renderInkComponent(<ToolApprovalModal {...defaultProps} />);
    const output = lastFrame();
    
    // Should display tool information
    expect(output).toContain("file_write");
    expect(output).toContain("/test/file.txt");
    expect(output).toContain("Tool Execution Request");
  });

  test("user can see modal with different risk levels", () => {
    const riskLevels = ["low", "medium", "high"] as const;
    
    riskLevels.forEach(riskLevel => {
      const { lastFrame } = renderInkComponent(<ToolApprovalModal {...defaultProps} riskLevel={riskLevel} />);
      const output = lastFrame();
      
      // Should render successfully for all risk levels
      expect(output).toContain("Tool Execution Request");
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

    const { lastFrame } = renderInkComponent(<ToolApprovalModal {...minimalProps} />);
    const output = lastFrame();
    
    // Should render successfully without optional props
    expect(output).toContain("Tool Execution Request");
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

    const { lastFrame } = renderInkComponent(<ToolApprovalModal {...defaultProps} toolCall={complexToolCall} />);
    const output = lastFrame();
    
    // Should handle complex parameters without error
    expect(output).toContain("Tool Execution Request");
    expect(output).toContain("api_call");
  });

  test("user can see modal with empty parameters", () => {
    const emptyParamsToolCall = {
      name: "status_check",
      input: {}
    };

    const { lastFrame } = renderInkComponent(<ToolApprovalModal {...defaultProps} toolCall={emptyParamsToolCall} />);
    const output = lastFrame();
    
    // Should handle empty parameters
    expect(output).toContain("Tool Execution Request");
    expect(output).toContain("status_check");
  });
});
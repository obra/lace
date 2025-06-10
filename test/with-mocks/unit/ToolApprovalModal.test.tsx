// ABOUTME: Unit tests for ToolApprovalModal component
// ABOUTME: Tests tool approval component structure and behavior

import React from "react";
import ToolApprovalModal from "@/ui/components/ToolApprovalModal";
import { Box, Text } from "ink";

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
    const element = ToolApprovalModal(defaultProps) as any;

    // Should return a Box with proper structure
    expect(element.type).toBe(Box);
    expect(element.props.flexDirection).toBe("column");
    expect(element.props.borderStyle).toBe("round");
    expect(element.props.borderColor).toBe("yellow");
    expect(element.props.padding).toBe(1);
  });

  test("user can see modal renders with tool information", () => {
    const element = ToolApprovalModal(defaultProps) as any;
    
    // Should have main container structure
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
    
    // Should have children representing the content sections
    expect(element.props.children).toBeDefined();
    expect(Array.isArray(element.props.children)).toBe(true);
  });

  test("user can see modal with different risk levels", () => {
    const riskLevels = ["low", "medium", "high"] as const;
    
    riskLevels.forEach(riskLevel => {
      const element = ToolApprovalModal({
        ...defaultProps,
        riskLevel
      }) as any;
      
      // Should render successfully for all risk levels
      expect(element.type).toBe(Box);
      expect(React.isValidElement(element)).toBe(true);
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

    const element = ToolApprovalModal(minimalProps) as any;
    
    // Should render successfully without optional props
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
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

    const element = ToolApprovalModal({
      ...defaultProps,
      toolCall: complexToolCall
    }) as any;
    
    // Should handle complex parameters without error
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });

  test("user can see modal with empty parameters", () => {
    const emptyParamsToolCall = {
      name: "status_check",
      input: {}
    };

    const element = ToolApprovalModal({
      ...defaultProps,
      toolCall: emptyParamsToolCall
    }) as any;
    
    // Should handle empty parameters
    expect(element.type).toBe(Box);
    expect(React.isValidElement(element)).toBe(true);
  });
});
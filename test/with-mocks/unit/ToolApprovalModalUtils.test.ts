// ABOUTME: Unit tests for tool approval modal utility functions
// ABOUTME: Tests pure business logic functions for tool approval workflow

import {
  getApprovalOptions,
  getRiskColor,
  formatParameters,
  parseModifiedParameters,
  createModifiedToolCall,
  createApprovalAction,
  type ToolCall,
  type RiskLevel
} from "@/ui/components/ToolApprovalModalUtils";

describe("ToolApprovalModalUtils", () => {
  describe("getApprovalOptions", () => {
    test("should return all approval options", () => {
      const options = getApprovalOptions();
      
      expect(options).toHaveLength(5);
      expect(options[0]).toEqual({ label: "Yes, execute as-is", value: "approve" });
      expect(options[1]).toEqual({ label: "Yes, but modify arguments", value: "modify" });
      expect(options[2]).toEqual({ label: "Yes, with comment after", value: "comment" });
      expect(options[3]).toEqual({ label: "No, skip this tool", value: "deny" });
      expect(options[4]).toEqual({ label: "No, stop and give instructions", value: "stop" });
    });
  });

  describe("getRiskColor", () => {
    test("should return correct colors for risk levels", () => {
      expect(getRiskColor("high")).toBe("red");
      expect(getRiskColor("medium")).toBe("yellow");
      expect(getRiskColor("low")).toBe("green");
    });

    test("should return white for unknown risk level", () => {
      expect(getRiskColor("unknown" as RiskLevel)).toBe("white");
    });
  });

  describe("formatParameters", () => {
    test("should format simple parameters", () => {
      const params = {
        name: "test",
        count: 42,
        enabled: true
      };

      const result = formatParameters(params);
      
      expect(result).toContain("name: test");
      expect(result).toContain("count: 42");
      expect(result).toContain("enabled: true");
    });

    test("should format complex parameters with JSON", () => {
      const params = {
        config: {
          nested: "value",
          array: [1, 2, 3]
        },
        simple: "string"
      };

      const result = formatParameters(params);
      
      expect(result).toContain("simple: string");
      expect(result).toContain("config:");
      expect(result).toContain("nested");
      expect(result).toContain("array");
    });

    test("should handle empty parameters", () => {
      const result = formatParameters({});
      expect(result).toBe("");
    });
  });

  describe("parseModifiedParameters", () => {
    test("should parse valid JSON", () => {
      const jsonString = '{"key": "value", "number": 42}';
      const result = parseModifiedParameters(jsonString, {});
      
      expect(result).toEqual({ key: "value", number: 42 });
    });

    test("should return fallback for invalid JSON", () => {
      const fallback = { default: "value" };
      const result = parseModifiedParameters("invalid json", fallback);
      
      expect(result).toBe(fallback);
    });

    test("should handle empty string", () => {
      const fallback = { empty: true };
      const result = parseModifiedParameters("", fallback);
      
      expect(result).toBe(fallback);
    });
  });

  describe("createModifiedToolCall", () => {
    test("should create modified tool call with new input", () => {
      const originalCall: ToolCall = {
        name: "test_tool",
        input: { original: "data" },
        description: "Test tool"
      };
      
      const newInput = { modified: "data", extra: 123 };
      const result = createModifiedToolCall(originalCall, newInput);
      
      expect(result.name).toBe("test_tool");
      expect(result.description).toBe("Test tool");
      expect(result.input).toEqual(newInput);
      expect(result.input).not.toBe(originalCall.input); // Should be new object
    });

    test("should preserve all original properties except input", () => {
      const originalCall: ToolCall = {
        name: "complex_tool",
        input: { a: 1, b: 2 },
        description: "Complex tool with description"
      };
      
      const newInput = { c: 3, d: 4 };
      const result = createModifiedToolCall(originalCall, newInput);
      
      expect(result).toEqual({
        name: "complex_tool",
        input: { c: 3, d: 4 },
        description: "Complex tool with description"
      });
    });
  });

  describe("createApprovalAction", () => {
    const mockToolCall: ToolCall = {
      name: "test_tool",
      input: { param: "value" }
    };

    test("should create approve action", () => {
      const action = createApprovalAction("approve", mockToolCall);
      
      expect(action.type).toBe("approve");
      expect(action.payload?.modifiedCall).toEqual(mockToolCall);
    });

    test("should create modify action with parsed parameters", () => {
      const modifiedParams = '{"newParam": "newValue", "count": 5}';
      const action = createApprovalAction("modify", mockToolCall, modifiedParams);
      
      expect(action.type).toBe("modify");
      expect(action.payload?.modifiedCall?.input).toEqual({
        newParam: "newValue",
        count: 5
      });
    });

    test("should create comment action", () => {
      const comment = "This tool looks good to execute";
      const action = createApprovalAction("comment", mockToolCall, undefined, comment);
      
      expect(action.type).toBe("comment");
      expect(action.payload?.modifiedCall).toEqual(mockToolCall);
      expect(action.payload?.comment).toBe(comment);
    });

    test("should create deny action", () => {
      const action = createApprovalAction("deny", mockToolCall);
      
      expect(action.type).toBe("deny");
      expect(action.payload?.reason).toBe("User denied tool execution");
    });

    test("should create stop action", () => {
      const action = createApprovalAction("stop", mockToolCall);
      
      expect(action.type).toBe("stop");
      expect(action.payload).toBeUndefined();
    });

    test("should handle invalid JSON in modify action", () => {
      const invalidJson = "{ invalid json }";
      const action = createApprovalAction("modify", mockToolCall, invalidJson);
      
      expect(action.type).toBe("modify");
      expect(action.payload?.modifiedCall?.input).toEqual(mockToolCall.input); // Should fallback
    });

    test("should throw error for modify action without parameters", () => {
      expect(() => {
        createApprovalAction("modify", mockToolCall);
      }).toThrow("Modified parameters required for modify action");
    });

    test("should throw error for unknown action", () => {
      expect(() => {
        createApprovalAction("unknown", mockToolCall);
      }).toThrow("Unknown action value: unknown");
    });

    test("should handle comment action without comment", () => {
      const action = createApprovalAction("comment", mockToolCall);
      
      expect(action.type).toBe("comment");
      expect(action.payload?.comment).toBe("");
    });
  });
});
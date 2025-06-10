// ABOUTME: Pure utility functions for tool approval modal
// ABOUTME: Testable business logic separated from UI components

export interface ToolCall {
  name: string;
  input: Record<string, any>;
  description?: string;
}

export type RiskLevel = "low" | "medium" | "high";
export type ApprovalMode = "select" | "modify" | "comment";

export interface ApprovalOption {
  label: string;
  value: string;
}

export const getApprovalOptions = (): ApprovalOption[] => [
  { label: "Yes, execute as-is", value: "approve" },
  { label: "Yes, but modify arguments", value: "modify" },
  { label: "Yes, with comment after", value: "comment" },
  { label: "No, skip this tool", value: "deny" },
  { label: "No, stop and give instructions", value: "stop" },
];

export const getRiskColor = (risk: RiskLevel): string => {
  switch (risk) {
    case "high":
      return "red";
    case "medium":
      return "yellow";
    case "low":
      return "green";
    default:
      return "white";
  }
};

export const formatParameters = (params: Record<string, any>): string => {
  return Object.entries(params)
    .map(([key, value]) => {
      const stringValue =
        typeof value === "string" ? value : JSON.stringify(value, null, 2);
      return `${key}: ${stringValue}`;
    })
    .join("\n");
};

export const parseModifiedParameters = (
  jsonString: string,
  fallback: Record<string, any>
): Record<string, any> => {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    return fallback;
  }
};

export const createModifiedToolCall = (
  originalCall: ToolCall,
  modifiedInput: Record<string, any>
): ToolCall => ({
  ...originalCall,
  input: modifiedInput,
});

export interface ApprovalAction {
  type: "approve" | "modify" | "comment" | "deny" | "stop";
  payload?: {
    modifiedCall?: ToolCall;
    comment?: string;
    reason?: string;
  };
}

export const createApprovalAction = (
  actionValue: string,
  toolCall: ToolCall,
  modifiedParams?: string,
  comment?: string
): ApprovalAction => {
  switch (actionValue) {
    case "approve":
      return {
        type: "approve",
        payload: { modifiedCall: toolCall }
      };
    case "modify":
      if (!modifiedParams) {
        throw new Error("Modified parameters required for modify action");
      }
      const parsedParams = parseModifiedParameters(modifiedParams, toolCall.input);
      const modifiedCall = createModifiedToolCall(toolCall, parsedParams);
      return {
        type: "modify",
        payload: { modifiedCall }
      };
    case "comment":
      return {
        type: "comment",
        payload: { modifiedCall: toolCall, comment: comment || "" }
      };
    case "deny":
      return {
        type: "deny",
        payload: { reason: "User denied tool execution" }
      };
    case "stop":
      return {
        type: "stop"
      };
    default:
      throw new Error(`Unknown action value: ${actionValue}`);
  }
};
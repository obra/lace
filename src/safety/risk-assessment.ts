// ABOUTME: Pure risk assessment functions for tool execution safety
// ABOUTME: Evaluates tool calls and assigns risk levels based on operation type and parameters

import type { ToolCall, RiskLevel } from "./types.js";

export function assessRisk(toolCall: ToolCall): RiskLevel {
  const toolName = toolCall.name.toLowerCase();
  const input = toolCall.input || {};

  // High risk operations
  if (isShellTool(toolName)) {
    return assessShellRisk(input);
  }

  if (isFileTool(toolName)) {
    return assessFileRisk(toolName, input);
  }

  if (isJavaScriptTool(toolName)) {
    return assessJavaScriptRisk(input);
  }

  // Default to low risk for unknown tools
  return "low";
}

function isShellTool(toolName: string): boolean {
  return (
    toolName.includes("shell") ||
    toolName.includes("execute") ||
    toolName.includes("bash") ||
    toolName.includes("cmd")
  );
}

function assessShellRisk(input: Record<string, any>): RiskLevel {
  const command = String(input.command || "").toLowerCase();

  // High risk shell operations
  const dangerousPatterns = [
    "rm ",
    "delete",
    "sudo",
    "chmod",
    "chown",
    "curl",
    "wget",
    "git clone",
    "npm install -g",
    "pip install",
    "apt install",
    "yum install",
    "&&",
    "||",
    "|",
    ">",
    ">>",
    "<",
    "eval",
    "exec",
    "system",
  ];

  if (dangerousPatterns.some((pattern) => command.includes(pattern))) {
    return "high";
  }

  // Medium risk for any shell execution
  return "medium";
}

function isFileTool(toolName: string): boolean {
  return toolName.includes("file");
}

function assessFileRisk(
  toolName: string,
  input: Record<string, any>,
): RiskLevel {
  // Check if this is explicitly a read-only operation
  const isReadOnly =
    toolName.includes("read") &&
    !toolName.includes("write") &&
    !toolName.includes("edit");
  if (isReadOnly) {
    return "low";
  }

  // Check if this involves writing/editing files
  const isWriteOperation =
    toolName.includes("write") ||
    toolName.includes("edit") ||
    input.operation === "write" ||
    input.operation === "edit";

  if (isWriteOperation) {
    const path = String(input.path || "").toLowerCase();

    // High risk paths
    const sensitivePatterns = [
      "/etc/",
      "package.json",
      ".env",
      "config",
      "passwd",
      "shadow",
      "hosts",
      ".ssh",
      "authorized_keys",
      "dockerfile",
      "docker-compose",
    ];

    if (sensitivePatterns.some((pattern) => path.includes(pattern))) {
      return "high";
    }

    return "medium";
  }

  // For generic file tools, check the path for sensitivity regardless of operation
  const path = String(input.path || "").toLowerCase();
  const sensitivePatterns = [
    "/etc/",
    "package.json",
    ".env",
    "config",
    "passwd",
    "shadow",
    "hosts",
    ".ssh",
    "authorized_keys",
    "dockerfile",
    "docker-compose",
  ];

  if (sensitivePatterns.some((pattern) => path.includes(pattern))) {
    return "high";
  }

  return "low";
}

function isJavaScriptTool(toolName: string): boolean {
  return (
    toolName.includes("javascript") ||
    toolName.includes("js") ||
    toolName.includes("eval")
  );
}

function assessJavaScriptRisk(input: Record<string, any>): RiskLevel {
  const code = String(input.code || input.expression || "").toLowerCase();

  // High risk JavaScript operations
  const dangerousPatterns = [
    "require",
    "import",
    "process",
    "eval",
    "exec",
    "spawn",
    "fs.",
    "filesystem",
    "unlinksync",
    "rmdirsync",
    "exit",
    "global",
    "window",
    "document",
  ];

  if (dangerousPatterns.some((pattern) => code.includes(pattern))) {
    return "high";
  }

  // Simple calculations and logging are safe
  return "low";
}

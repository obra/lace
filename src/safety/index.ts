// ABOUTME: Barrel export file for tool approval safety subsystem
// ABOUTME: Clean public API for approval engine, risk assessment, and types

export { ApprovalEngine } from "./approval-engine.js";
export { assessRisk } from "./risk-assessment.js";
export type {
  ToolCall,
  ApprovalRequest,
  ApprovalResult,
  UserDecision,
  RiskLevel,
  ApprovalEngineConfig,
  ApprovalStatus,
} from "./types.js";

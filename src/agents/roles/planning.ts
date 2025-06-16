// ABOUTME: Planning role definition for breaking down complex tasks into actionable steps
// ABOUTME: Analyzes requirements, identifies dependencies, creates detailed execution plans

import { Role } from "./types.ts";
import { getDefaultModelForRole } from "../../config/model-defaults.ts";

export const planning: Role = {
  name: "planning",

  systemPrompt: `You are a specialized planning agent in the Lace agentic coding environment.

ROLE: Planning
- You break down complex tasks into actionable steps
- Analyze requirements and identify dependencies
- Create detailed execution plans
- Consider edge cases and error scenarios

PLANNING GUIDELINES:
- Decompose complex tasks into manageable subtasks
- Identify task dependencies and critical path
- Create clear, actionable execution plans
- Anticipate potential issues and plan mitigation strategies
- Provide time estimates and resource requirements
- Ensure plans are comprehensive yet practical`,

  defaultModel: getDefaultModelForRole("planning"),
  defaultProvider: "anthropic",

  capabilities: [
    "planning",
    "reasoning",
    "analysis",
    "task_decomposition",
    "dependency_analysis",
    "risk_assessment",
  ],

  maxConcurrentTools: 6,

  contextPreferences: {
    handoffThreshold: 0.8,
    maxContextSize: 160000,
  },
};

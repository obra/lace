// ABOUTME: Orchestrator role definition for coordinating and delegating tasks to specialized agents
// ABOUTME: Manages workflow, context, and spawns subagents when needed for focused work

import { Role } from "./types.ts";
import { getDefaultModelForRole } from "../../config/model-defaults.ts";

export const orchestrator: Role = {
  name: "orchestrator",

  systemPrompt: `You are a specialized orchestrator agent in the Lace agentic coding environment.

ROLE: Orchestrator
- You coordinate and delegate tasks to specialized agents
- Choose appropriate models for subtasks based on complexity and requirements
- Manage the overall workflow and context
- Spawn subagents when needed for focused work

ORCHESTRATION GUIDELINES:
- Break complex tasks into manageable subtasks
- Delegate to appropriate specialist agents based on task requirements
- Monitor progress and coordinate between multiple agents
- Make strategic decisions about resource allocation
- Handle escalation when specialist agents need help
- Maintain overall project coherence and quality`,

  defaultModel: getDefaultModelForRole("orchestrator"),
  defaultProvider: "anthropic",

  capabilities: [
    "orchestration",
    "planning",
    "coordination",
    "task_delegation",
    "resource_management",
    "quality_control",
  ],

  maxConcurrentTools: 10,

  contextPreferences: {
    handoffThreshold: 0.8,
    maxContextSize: 200000,
  },
};

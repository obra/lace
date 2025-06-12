// ABOUTME: Agent registry that manages all available agent roles for the system
// ABOUTME: Provides plugin-style architecture for extensible agent role ecosystem

import { Role, RoleName, isValidRoleName } from "./roles/types.ts";
import { orchestrator } from "./roles/orchestrator.ts";
import { execution } from "./roles/execution.ts";
import { reasoning } from "./roles/reasoning.ts";
import { planning } from "./roles/planning.ts";
import { memory } from "./roles/memory.ts";
import { synthesis } from "./roles/synthesis.ts";
import { general } from "./roles/general.ts";

/**
 * Extended role interface with metadata capabilities
 */
export interface AgentRole extends Role {
  /**
   * Get comprehensive metadata about this role
   */
  getMetadata(): AgentRoleMetadata;
}

/**
 * Agent role metadata interface
 */
export interface AgentRoleMetadata {
  name: string;
  description: string;
  usage_guidance?: string;
  systemPrompt: string;
  defaultModel: string;
  defaultProvider: string;
  capabilities: string[];
  toolRestrictions?: {
    allowed?: string[];
    denied?: string[];
  };
  maxConcurrentTools?: number;
  contextPreferences?: {
    handoffThreshold?: number;
    maxContextSize?: number;
  };
}

/**
 * Enhanced role wrapper that adds metadata capabilities
 */
class EnhancedRole implements AgentRole {
  constructor(
    private role: Role,
    private description: string,
    private usageGuidance?: string
  ) {}

  get name() { return this.role.name; }
  get systemPrompt() { return this.role.systemPrompt; }
  get defaultModel() { return this.role.defaultModel; }
  get defaultProvider() { return this.role.defaultProvider; }
  get capabilities() { return this.role.capabilities; }
  get toolRestrictions() { return this.role.toolRestrictions; }
  get maxConcurrentTools() { return this.role.maxConcurrentTools; }
  get contextPreferences() { return this.role.contextPreferences; }

  getMetadata(): AgentRoleMetadata {
    return {
      name: this.name,
      description: this.description,
      usage_guidance: this.usageGuidance,
      systemPrompt: this.systemPrompt,
      defaultModel: this.defaultModel,
      defaultProvider: this.defaultProvider,
      capabilities: this.capabilities,
      toolRestrictions: this.toolRestrictions,
      maxConcurrentTools: this.maxConcurrentTools,
      contextPreferences: this.contextPreferences,
    };
  }
}

/**
 * Agent registry that manages all available agent roles
 */
export class AgentRegistry {
  private roles: Map<string, AgentRole>;

  constructor() {
    this.roles = new Map();
  }

  /**
   * Initialize the registry with default roles
   */
  initialize(): void {
    // Register all default roles with enhanced metadata
    this.registerRole("orchestrator", new EnhancedRole(
      orchestrator,
      "Coordinates and delegates tasks across multiple agents",
      `Use the orchestrator role when you need to:
- Break down complex tasks into subtasks
- Coordinate multiple agents working together
- Manage high-level project workflows
- Make decisions about task delegation

DON'T use for simple, single-agent tasks.`
    ));

    this.registerRole("execution", new EnhancedRole(
      execution,
      "Efficiently executes specific tasks and implementations",
      `Use the execution role when you need to:
- Implement specific features or fixes
- Run commands and use tools efficiently
- Follow detailed instructions step-by-step
- Complete concrete, well-defined tasks

Best for: coding, testing, file operations, command execution.`
    ));

    this.registerRole("reasoning", new EnhancedRole(
      reasoning,
      "Performs deep analysis and complex problem-solving",
      `Use the reasoning role when you need to:
- Analyze complex problems or code architecture
- Debug difficult issues requiring investigation
- Review and evaluate code quality or security
- Make architectural or design decisions

Best for: code reviews, debugging, analysis, research.`
    ));

    this.registerRole("planning", new EnhancedRole(
      planning,
      "Creates comprehensive plans and breaks down complex tasks",
      `Use the planning role when you need to:
- Break down large features into manageable tasks
- Create project roadmaps and timelines
- Design system architecture and workflows
- Plan migrations or refactoring efforts

Best for: project planning, architecture design, task breakdown.`
    ));

    this.registerRole("memory", new EnhancedRole(
      memory,
      "Manages and queries historical context and information",
      `Use the memory role when you need to:
- Query conversation history or past decisions
- Maintain context across long conversations
- Search through project documentation
- Track progress and previous work

Best for: context retrieval, documentation search, progress tracking.`
    ));

    this.registerRole("synthesis", new EnhancedRole(
      synthesis,
      "Combines and summarizes information from multiple sources",
      `Use the synthesis role when you need to:
- Combine information from multiple sources
- Create summaries and documentation
- Process and organize large amounts of data
- Generate reports or overviews

Best for: documentation, reporting, data processing, summarization.`
    ));

    this.registerRole("general", new EnhancedRole(
      general,
      "Versatile role for general-purpose tasks and conversations",
      `Use the general role when:
- The task doesn't fit other specialized roles
- You need a balanced approach to problem-solving
- Working on diverse, mixed-type tasks
- Starting work before determining the best specialized role

This is the default fallback role.`
    ));
  }

  /**
   * Register a new role in the registry
   */
  registerRole(name: string, role: AgentRole): void {
    this.roles.set(name, role);
  }

  /**
   * Get a role by name
   */
  getRole(name: string): AgentRole | undefined {
    return this.roles.get(name);
  }

  /**
   * Check if a role exists in the registry
   */
  hasRole(name: string): boolean {
    return this.roles.has(name);
  }

  /**
   * Get all registered role names
   */
  listRoles(): string[] {
    return Array.from(this.roles.keys());
  }

  /**
   * Get all roles as an array
   */
  getAllRoles(): AgentRole[] {
    return Array.from(this.roles.values());
  }

  /**
   * Get metadata for all roles
   */
  getAllRoleMetadata(): AgentRoleMetadata[] {
    return this.getAllRoles().map(role => role.getMetadata());
  }

  /**
   * Validate if a role name is valid and registered
   */
  isValidRole(name: string): boolean {
    return this.hasRole(name) && isValidRoleName(name);
  }
}

// Create and initialize the default registry instance
export const agentRegistry = new AgentRegistry();
agentRegistry.initialize();

// Maintain backward compatibility with existing role-registry exports
export function getRole(name: string): AgentRole {
  if (!isValidRoleName(name)) {
    const validRoles = agentRegistry.listRoles().join(", ");
    throw new Error(
      `INVALID AGENT ROLE: '${name}'. Valid roles are: ${validRoles}`,
    );
  }

  const role = agentRegistry.getRole(name);
  if (!role) {
    throw new Error(`Role '${name}' not found in registry`);
  }

  return role;
}

export function getAllRoleNames(): RoleName[] {
  return agentRegistry.listRoles() as RoleName[];
}

export function isValidRole(name: string): boolean {
  return agentRegistry.isValidRole(name);
}

export function getRoleMetadata(): Array<{
  name: string;
  capabilities: string[];
  defaultModel: string;
}> {
  return agentRegistry.getAllRoleMetadata().map((role) => ({
    name: role.name,
    capabilities: role.capabilities,
    defaultModel: role.defaultModel,
  }));
}
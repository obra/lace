// ABOUTME: Central registry for agent roles with validation and retrieval functions
// ABOUTME: Provides getRole() function and maintains the official list of available roles

import { Role, RoleName, isValidRoleName } from "./roles/types.ts";
import { orchestrator } from "./roles/orchestrator.ts";
import { execution } from "./roles/execution.ts";
import { reasoning } from "./roles/reasoning.ts";
import { planning } from "./roles/planning.ts";
import { memory } from "./roles/memory.ts";
import { synthesis } from "./roles/synthesis.ts";
import { general } from "./roles/general.ts";

/** Registry of all available roles */
const ROLES: Record<RoleName, Role> = {
  orchestrator,
  execution,
  reasoning,
  planning,
  memory,
  synthesis,
  general,
};

/**
 * Get a role definition by name with strict validation
 * @param name - The role name to retrieve
 * @returns The role definition
 * @throws Error if role name is invalid
 */
export function getRole(name: string): Role {
  if (!isValidRoleName(name)) {
    const validRoles = Object.keys(ROLES).join(", ");
    throw new Error(
      `INVALID AGENT ROLE: '${name}'. Valid roles are: ${validRoles}`,
    );
  }

  return ROLES[name];
}

/**
 * Get all available role names
 * @returns Array of valid role names
 */
export function getAllRoleNames(): RoleName[] {
  return Object.keys(ROLES) as RoleName[];
}

/**
 * Check if a role name is valid without throwing
 * @param name - The role name to check
 * @returns True if valid, false otherwise
 */
export function isValidRole(name: string): boolean {
  return isValidRoleName(name);
}

/**
 * Get role metadata (name, capabilities, model) for all roles
 * @returns Array of role metadata objects
 */
export function getRoleMetadata(): Array<{
  name: string;
  capabilities: string[];
  defaultModel: string;
}> {
  return Object.values(ROLES).map((role) => ({
    name: role.name,
    capabilities: role.capabilities,
    defaultModel: role.defaultModel,
  }));
}

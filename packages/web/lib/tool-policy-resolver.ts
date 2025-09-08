// ABOUTME: Tool policy hierarchy resolver for progressive restriction enforcement
// ABOUTME: Computes effective policies, allowed values, and parent values for UI components

export type ToolPolicy = 'allow' | 'ask' | 'deny' | 'disable';

export interface ToolPolicyInfo {
  value: ToolPolicy;
  allowedValues: ToolPolicy[];
  projectValue?: ToolPolicy;
  globalValue?: ToolPolicy;
}

export interface ToolPolicyHierarchy {
  global?: Record<string, ToolPolicy> | {};
  project?: Record<string, ToolPolicy> | {};
  session?: Record<string, ToolPolicy> | {};
}

/**
 * Resolves tool policy hierarchy and computes allowed values for UI
 */
export class ToolPolicyResolver {
  private static readonly RESTRICTION_ORDER: ToolPolicy[] = ['allow', 'ask', 'deny', 'disable'];

  /**
   * Get allowed values based on parent policy (progressive restriction)
   */
  private static getAllowedValues(parentPolicy?: ToolPolicy): ToolPolicy[] {
    if (!parentPolicy) {
      return [...this.RESTRICTION_ORDER]; // All options available
    }

    const parentIndex = this.RESTRICTION_ORDER.indexOf(parentPolicy);
    // Can choose parent level or more restrictive + disable is always available
    const restrictedOptions = this.RESTRICTION_ORDER.slice(parentIndex);

    // Ensure disable is always available as ultimate restriction
    if (!restrictedOptions.includes('disable')) {
      restrictedOptions.push('disable');
    }

    return restrictedOptions;
  }

  /**
   * Get effective policy (most restrictive in hierarchy)
   */
  private static getEffectivePolicy(
    globalPolicy?: ToolPolicy,
    projectPolicy?: ToolPolicy,
    sessionPolicy?: ToolPolicy
  ): ToolPolicy {
    // Session overrides project, project overrides global
    if (sessionPolicy) return sessionPolicy;
    if (projectPolicy) return projectPolicy;
    if (globalPolicy) return globalPolicy;
    return 'ask'; // Default policy
  }

  /**
   * Resolve tool policy information for session level
   */
  static resolveSessionToolPolicies(
    tools: string[],
    hierarchy: ToolPolicyHierarchy
  ): Record<string, ToolPolicyInfo> {
    const result: Record<string, ToolPolicyInfo> = {};

    for (const tool of tools) {
      const globalPolicy = hierarchy.global?.[tool];
      const projectPolicy = hierarchy.project?.[tool];
      const sessionPolicy = hierarchy.session?.[tool];

      const effectivePolicy = this.getEffectivePolicy(globalPolicy, projectPolicy, sessionPolicy);
      const parentPolicy = projectPolicy || globalPolicy;
      const allowedValues = this.getAllowedValues(parentPolicy);

      const info: ToolPolicyInfo = {
        value: effectivePolicy,
        allowedValues,
      };

      // Add parent values when they exist
      if (projectPolicy) {
        info.projectValue = projectPolicy;
      }
      if (globalPolicy) {
        info.globalValue = globalPolicy;
      }

      result[tool] = info;
    }

    return result;
  }

  /**
   * Resolve tool policy information for project level
   */
  static resolveProjectToolPolicies(
    tools: string[],
    hierarchy: ToolPolicyHierarchy
  ): Record<string, ToolPolicyInfo> {
    const result: Record<string, ToolPolicyInfo> = {};

    for (const tool of tools) {
      const globalPolicy = hierarchy.global?.[tool];
      const projectPolicy = hierarchy.project?.[tool];

      const effectivePolicy = this.getEffectivePolicy(globalPolicy, projectPolicy);
      const allowedValues = this.getAllowedValues(globalPolicy);

      const info: ToolPolicyInfo = {
        value: effectivePolicy,
        allowedValues,
      };

      // Add global value when it exists
      if (globalPolicy) {
        info.globalValue = globalPolicy;
      }

      result[tool] = info;
    }

    return result;
  }

  /**
   * Resolve tool policy information for global level
   */
  static resolveGlobalToolPolicies(
    tools: string[],
    policies: Record<string, ToolPolicy>
  ): Record<string, ToolPolicyInfo> {
    const result: Record<string, ToolPolicyInfo> = {};

    for (const tool of tools) {
      const policy = policies[tool] || 'ask';

      result[tool] = {
        value: policy,
        allowedValues: [...this.RESTRICTION_ORDER], // All options available at global level
      };
    }

    return result;
  }

  /**
   * Validate that a policy change is allowed (for API validation)
   */
  static isValidPolicyChange(
    tool: string,
    newPolicy: ToolPolicy,
    parentPolicy?: ToolPolicy
  ): boolean {
    const allowedValues = this.getAllowedValues(parentPolicy);
    return allowedValues.includes(newPolicy);
  }
}

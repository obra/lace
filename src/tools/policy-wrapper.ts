// ABOUTME: Global policy wrapper that applies CLI options to any approval callback interface
// ABOUTME: Ensures CLI tool policies work regardless of which interface is running (CLI, web, React/Ink)

import { ApprovalCallback, ApprovalDecision } from '~/tools/approval-types.js';
import { CLIOptions } from '~/cli/args.js';
import { ToolExecutor } from '~/tools/executor.js';

export function createGlobalPolicyCallback(
  interfaceCallback: ApprovalCallback,
  cliOptions: CLIOptions,
  toolExecutor: ToolExecutor
): ApprovalCallback {
  // Session cache for ALLOW_SESSION decisions
  const sessionCache = new Map<string, boolean>();

  return {
    async requestApproval(toolName: string, input: unknown): Promise<ApprovalDecision> {
      // 1. Check session cache first
      if (sessionCache.has(toolName)) {
        return ApprovalDecision.ALLOW_SESSION;
      }

      // 1.5. Check if tool is marked as safe internal
      const tool = toolExecutor.getTool(toolName);
      if (tool?.annotations?.safeInternal === true) {
        return ApprovalDecision.ALLOW_ONCE;
      }

      // 2. Check if all tools are disabled (highest policy precedence)
      if (cliOptions.disableAllTools) {
        return ApprovalDecision.DENY;
      }

      // 3. Check if specific tool is disabled
      if (cliOptions.disableTools.includes(toolName)) {
        return ApprovalDecision.DENY;
      }

      // 4. Check if guardrails are disabled (auto-approve everything)
      if (cliOptions.disableToolGuardrails) {
        return ApprovalDecision.ALLOW_ONCE;
      }

      // 5. Check auto-approve list
      if (cliOptions.autoApproveTools.includes(toolName)) {
        return ApprovalDecision.ALLOW_ONCE;
      }

      // 6. Check if tool is read-only and non-destructive tools are allowed
      if (cliOptions.allowNonDestructiveTools) {
        const tool = toolExecutor.getTool(toolName);
        if (tool?.annotations?.readOnlyHint === true) {
          return ApprovalDecision.ALLOW_ONCE;
        }
      }

      // 7. Fall back to interface-specific approval (CLI, web, React/Ink, etc.)
      const decision = await interfaceCallback.requestApproval(toolName, input);

      // 8. Cache session approvals
      if (decision === ApprovalDecision.ALLOW_SESSION) {
        sessionCache.set(toolName, true);
      }

      return decision;
    },
  };
}

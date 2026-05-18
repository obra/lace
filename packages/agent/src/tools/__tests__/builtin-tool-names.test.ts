// ABOUTME: Guards LACE_BUILTIN_TOOL_NAMES stays in sync with registerAllAvailableTools.
// ABOUTME: If someone adds/removes a builtin tool without updating the constant, this fails.

import { describe, expect, it } from 'vitest';
import { ToolExecutor, LACE_BUILTIN_TOOL_NAMES } from '../executor';
import { SkillRegistry } from '@lace/agent/skills';

describe('LACE_BUILTIN_TOOL_NAMES', () => {
  it('matches the tools actually registered by registerAllAvailableTools', () => {
    const executor = new ToolExecutor();
    // Provide a SkillRegistry so use_skill is registered, matching session/new.
    // Empty skillDirs is fine — registration does not require any skills to exist.
    const skillRegistry = new SkillRegistry({ skillDirs: [] });
    executor.registerAllAvailableTools(skillRegistry);

    const registeredNames = new Set(executor.getAllTools().map((t) => t.name));
    const constantNames = new Set<string>(LACE_BUILTIN_TOOL_NAMES);

    // Every registered tool must appear in the constant (catches additions
    // to registerAllAvailableTools that forgot to update the constant).
    for (const name of registeredNames) {
      expect(
        constantNames.has(name),
        `Tool "${name}" is registered by registerAllAvailableTools but missing from LACE_BUILTIN_TOOL_NAMES`
      ).toBe(true);
    }

    // Every constant entry must be a registered tool (catches stale entries
    // left behind after a tool was removed from registerAllAvailableTools).
    for (const name of constantNames) {
      expect(
        registeredNames.has(name),
        `Tool "${name}" is listed in LACE_BUILTIN_TOOL_NAMES but not registered by registerAllAvailableTools`
      ).toBe(true);
    }

    // Belt-and-suspenders: full set equality.
    expect(registeredNames).toEqual(constantNames);
  });
});

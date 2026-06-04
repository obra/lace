// ABOUTME: Tool to activate a skill and get its instructions and location

import { z } from 'zod';
import { Tool } from '../tool';
import type { ToolResult, ToolContext, ToolAnnotations } from '../types';
import type { SkillRegistry } from '@lace/agent/skills';

const useSkillSchema = z.object({
  skill: z.string().min(1, 'Skill name is required').describe('Name of the skill to activate'),
});

/**
 * Tool that activates a skill and returns its full content.
 *
 * Skills provide expert guidance for specific workflows. When the agent sees
 * a relevant skill in its available skills list, it can use this tool to get
 * the full instructions.
 *
 * Returns the skill body content along with the skill directory path for
 * accessing any additional resources the skill might reference.
 */
export class UseSkillTool extends Tool {
  name = 'use_skill';
  description =
    'Activate a skill to get specialized instructions for a task. ' +
    'Skills provide expert guidance for specific workflows like committing code, reviewing PRs, etc. ' +
    'Use this when you see a relevant skill in your available skills list.';
  schema = useSkillSchema;
  annotations: ToolAnnotations = {
    readOnlyHint: true,
    idempotentHint: true,
  };

  constructor(private readonly registry: SkillRegistry) {
    super();
  }

  protected async executeValidated(
    args: z.infer<typeof useSkillSchema>,
    _context: ToolContext
  ): Promise<ToolResult> {
    const { skill: skillName } = args;

    // Cache may be stale if a skill was authored after registry construction
    // (e.g. via the embedder's create_skill tool). Refresh once on miss before
    // declaring the skill not found.
    let content = this.registry.getSkillContent(skillName);
    if (!content) {
      this.registry.refresh();
      content = this.registry.getSkillContent(skillName);
    }
    if (!content) {
      return this.createError(
        `Skill '${skillName}' not found. Check available skills in your system prompt.`
      );
    }

    const output = [
      `Skill: ${skillName}`,
      `Location: ${content.skillDir}`,
      '',
      '---',
      '',
      content.body,
    ].join('\n');

    return this.createResult(output);
  }
}

// ABOUTME: SkillVariableProvider generates available_skills XML for injection into system prompts

import type { SkillRegistry } from './registry';

/**
 * Escapes HTML entities in a string to prevent XML injection.
 *
 * Escapes: < > & " '
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Provides available skills as XML for system prompt injection.
 *
 * Generates an `<available_skills>` block containing skill names and descriptions
 * that can be included in the agent's system prompt.
 */
export class SkillVariableProvider {
  constructor(private readonly registry: SkillRegistry) {}

  /**
   * Returns variables for template injection.
   *
   * @returns Object containing `availableSkills` as an XML string
   */
  getVariables(): Record<string, unknown> {
    // Rescan on every call so skills authored mid-session (e.g. via sen-core's
    // create_skill tool) appear in the next system-prompt rebuild.
    this.registry.refresh();
    const skills = this.registry.listSkills();

    if (skills.length === 0) {
      return {
        availableSkills: '<available_skills>\n</available_skills>',
      };
    }

    const skillElements = skills
      .map((skill) => {
        const name = escapeHtml(skill.name);
        const description = escapeHtml(skill.description);
        return `<skill>\n<name>${name}</name>\n<description>${description}</description>\n</skill>`;
      })
      .join('\n');

    return {
      availableSkills: `<available_skills>\n${skillElements}\n</available_skills>`,
    };
  }
}

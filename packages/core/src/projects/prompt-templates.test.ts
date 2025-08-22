// ABOUTME: Tests for custom prompt templates with variable substitution
// ABOUTME: Tests template storage, retrieval, rendering, and inheritance features

import { describe, it, expect, beforeEach } from 'vitest';
import { PromptTemplate, PromptTemplateManager } from '~/projects/prompt-templates';

describe('Custom prompt templates', () => {
  let templateManager: PromptTemplateManager;
  let projectId: string;

  beforeEach(() => {
    templateManager = new PromptTemplateManager();
    projectId = 'project1';
  });

  it('should store and retrieve custom templates', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Code Review',
      description: 'Template for code review sessions',
      content: 'You are a senior software engineer reviewing code. Focus on: {{focus_areas}}',
      variables: ['focus_areas'],
      projectId,
    });

    templateManager.saveTemplate(template);
    const retrieved = templateManager.getTemplate(projectId, 'custom-template');

    expect(retrieved).toBeDefined();
    expect(retrieved?.getName()).toBe('Custom Code Review');
    expect(retrieved?.getVariables()).toEqual(['focus_areas']);
  });

  it('should render template with variables', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Code Review',
      description: 'Template for code review sessions',
      content: 'You are a {{role}} reviewing {{type}}. Focus on: {{focus_areas}}',
      variables: ['role', 'type', 'focus_areas'],
      projectId,
    });

    templateManager.saveTemplate(template);

    const rendered = templateManager.renderTemplate(projectId, 'custom-template', {
      role: 'senior software engineer',
      type: 'TypeScript code',
      focus_areas: 'type safety, performance, maintainability',
    });

    expect(rendered).toBe(
      'You are a senior software engineer reviewing TypeScript code. Focus on: type safety, performance, maintainability'
    );
  });

  it('should validate required variables', () => {
    const template = new PromptTemplate({
      id: 'custom-template',
      name: 'Custom Template',
      description: 'A template with required variables',
      content: 'Hello {{name}}, you are working on {{project}}',
      variables: ['name', 'project'],
      projectId,
    });

    templateManager.saveTemplate(template);

    expect(() => {
      templateManager.renderTemplate(projectId, 'custom-template', {
        name: 'John',
        // missing 'project' variable
      });
    }).toThrow('Missing required variable: project');
  });

  it('should list templates for project', () => {
    const template1 = new PromptTemplate({
      id: 'template1',
      name: 'Template 1',
      description: 'First template',
      content: 'Content 1',
      variables: [],
      projectId,
    });

    const template2 = new PromptTemplate({
      id: 'template2',
      name: 'Template 2',
      description: 'Second template',
      content: 'Content 2',
      variables: [],
      projectId,
    });

    templateManager.saveTemplate(template1);
    templateManager.saveTemplate(template2);

    const templates = templateManager.getTemplatesForProject(projectId);
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.getId())).toContain('template1');
    expect(templates.map((t) => t.getId())).toContain('template2');
  });

  it('should inherit from parent templates', () => {
    const parentTemplate = new PromptTemplate({
      id: 'parent-template',
      name: 'Parent Template',
      description: 'Base template',
      content: 'Base instructions: {{base_instructions}}',
      variables: ['base_instructions'],
      projectId,
    });

    const childTemplate = new PromptTemplate({
      id: 'child-template',
      name: 'Child Template',
      description: 'Extended template',
      content: '{{parent}} Additional instructions: {{additional_instructions}}',
      variables: ['additional_instructions'],
      parentTemplateId: 'parent-template',
      projectId,
    });

    templateManager.saveTemplate(parentTemplate);
    templateManager.saveTemplate(childTemplate);

    const rendered = templateManager.renderTemplate(projectId, 'child-template', {
      base_instructions: 'Be helpful and accurate',
      additional_instructions: 'Focus on TypeScript best practices',
    });

    expect(rendered).toBe(
      'Base instructions: Be helpful and accurate Additional instructions: Focus on TypeScript best practices'
    );
  });
});

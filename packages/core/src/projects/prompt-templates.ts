// ABOUTME: Custom prompt templates with variable substitution and inheritance
// ABOUTME: Allows projects to define reusable prompt templates with dynamic content

interface PromptTemplateConfig {
  id: string;
  name: string;
  description: string;
  content: string;
  variables: string[];
  projectId: string;
  parentTemplateId?: string;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class PromptTemplate {
  private config: PromptTemplateConfig;

  constructor(config: PromptTemplateConfig) {
    this.config = {
      ...config,
      createdAt: config.createdAt || new Date(),
      updatedAt: config.updatedAt || new Date(),
    };
  }

  getId(): string {
    return this.config.id;
  }

  getName(): string {
    return this.config.name;
  }

  getDescription(): string {
    return this.config.description;
  }

  getContent(): string {
    return this.config.content;
  }

  getVariables(): string[] {
    return this.config.variables;
  }

  getProjectId(): string {
    return this.config.projectId;
  }

  getParentTemplateId(): string | undefined {
    return this.config.parentTemplateId;
  }

  isDefault(): boolean {
    return this.config.isDefault || false;
  }

  render(variables: Record<string, string>): string {
    let content = this.config.content;

    // Replace variables in content
    for (const [key, value] of Object.entries(variables)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }

    // Check for unresolved variables
    const unresolvedVariables = content.match(/\{\{[^}]+\}\}/g);
    if (unresolvedVariables) {
      throw new Error(`Unresolved variables: ${unresolvedVariables.join(', ')}`);
    }

    return content;
  }

  validateVariables(variables: Record<string, string>): void {
    for (const requiredVar of this.config.variables) {
      if (!(requiredVar in variables)) {
        throw new Error(`Missing required variable: ${requiredVar}`);
      }
    }
  }

  update(updates: Partial<PromptTemplateConfig>): void {
    this.config = {
      ...this.config,
      ...updates,
      updatedAt: new Date(),
    };
  }

  toJSON(): PromptTemplateConfig {
    return { ...this.config };
  }
}

export class PromptTemplateManager {
  private templates = new Map<string, Map<string, PromptTemplate>>();

  saveTemplate(template: PromptTemplate): void {
    const projectId = template.getProjectId();
    let projectTemplates = this.templates.get(projectId);

    if (!projectTemplates) {
      projectTemplates = new Map();
      this.templates.set(projectId, projectTemplates);
    }

    projectTemplates.set(template.getId(), template);
  }

  getTemplate(projectId: string, templateId: string): PromptTemplate | undefined {
    const projectTemplates = this.templates.get(projectId);
    return projectTemplates?.get(templateId);
  }

  getTemplatesForProject(projectId: string): PromptTemplate[] {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return [];

    return Array.from(projectTemplates.values());
  }

  async renderTemplate(projectId: string, templateId: string, variables: Record<string, string>): Promise<string> {
    const template = this.getTemplate(projectId, templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Handle parent template inheritance
    let renderedContent = template.getContent();

    if (template.getParentTemplateId()) {
      const parentTemplate = this.getTemplate(projectId, template.getParentTemplateId()!);
      if (parentTemplate) {
        const parentContent = parentTemplate.render(variables);
        renderedContent = renderedContent.replace(/\{\{parent\}\}/g, parentContent);
      }
    }

    // Validate all required variables are provided
    template.validateVariables(variables);

    // Create temporary template for rendering
    const tempTemplate = new PromptTemplate({
      ...template.toJSON(),
      content: renderedContent,
    });

    return tempTemplate.render(variables);
  }

  deleteTemplate(projectId: string, templateId: string): boolean {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return false;

    return projectTemplates.delete(templateId);
  }

  getDefaultTemplate(projectId: string): PromptTemplate | undefined {
    const projectTemplates = this.templates.get(projectId);
    if (!projectTemplates) return undefined;

    return Array.from(projectTemplates.values()).find((t) => t.isDefault());
  }
}

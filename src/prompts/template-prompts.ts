// ABOUTME: Template-based prompt configuration that replaces static prompt files
// ABOUTME: Provides compatibility with existing PromptConfig interface while adding template functionality

import { PromptManager } from './prompt-manager.js';
import { PromptVariables } from './types.js';
import { Tool } from '../tools/types.js';
import { logger } from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface TemplatePromptConfig {
  systemPrompt: string;
  userInstructions: string;
  filesCreated: string[];
}

export interface TemplatePromptOptions {
  laceDir: string;
  workingDir?: string;
  tools?: Tool[];
  model?: {
    id: string;
    provider: string;
  };
  additionalVariables?: PromptVariables;
}

/**
 * Load template-based prompt configuration with compatibility for existing PromptConfig interface
 */
export function loadTemplatePromptConfig(options: TemplatePromptOptions): TemplatePromptConfig {
  const {
    laceDir,
    workingDir = process.cwd(),
    tools = [],
    model,
    additionalVariables = {}
  } = options;

  const promptsDir = path.join(laceDir, 'prompts');
  const userInstructionsPath = path.join(laceDir, 'instructions.md');
  const filesCreated: string[] = [];

  // Ensure prompts directory exists
  if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir, { recursive: true });
    logger.debug('Created prompts directory', { promptsDir });
  }

  // Ensure sections directory exists
  const sectionsDir = path.join(promptsDir, 'sections');
  if (!fs.existsSync(sectionsDir)) {
    fs.mkdirSync(sectionsDir);
    logger.debug('Created sections directory', { sectionsDir });
  }

  // Create default template files if they don't exist
  const templateFiles = [
    {
      path: path.join(promptsDir, 'system.md'),
      content: getDefaultSystemTemplate()
    },
    {
      path: path.join(sectionsDir, 'agent-personality.md'),
      content: getDefaultPersonalitySection()
    },
    {
      path: path.join(sectionsDir, 'tools.md'),
      content: getDefaultToolsSection()
    },
    {
      path: path.join(sectionsDir, 'environment.md'),
      content: getDefaultEnvironmentSection()
    },
    {
      path: path.join(sectionsDir, 'guidelines.md'),
      content: getDefaultGuidelinesSection()
    }
  ];

  for (const { path: filePath, content } of templateFiles) {
    if (!fs.existsSync(filePath)) {
      try {
        fs.writeFileSync(filePath, content, 'utf-8');
        filesCreated.push(filePath);
        logger.debug('Created default template file', { filePath });
      } catch (error) {
        logger.warn('Failed to create template file', {
          filePath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // Create default user instructions if they don't exist
  if (!fs.existsSync(userInstructionsPath)) {
    try {
      fs.writeFileSync(userInstructionsPath, getDefaultUserInstructions(), 'utf-8');
      filesCreated.push(userInstructionsPath);
      logger.debug('Created default user instructions', { userInstructionsPath });
    } catch (error) {
      logger.warn('Failed to create user instructions', {
        userInstructionsPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Create prompt manager and generate system prompt
  const promptManager = new PromptManager(promptsDir, workingDir, tools);
  
  // Prepare variables
  const variables: PromptVariables = { ...additionalVariables };
  if (model) {
    variables.model = model;
  }

  const systemPrompt = promptManager.generateSystemPrompt(variables);

  // Load user instructions
  let userInstructions = '';
  try {
    if (fs.existsSync(userInstructionsPath)) {
      userInstructions = fs.readFileSync(userInstructionsPath, 'utf-8').trim();
    }
  } catch (error) {
    logger.warn('Failed to load user instructions', {
      userInstructionsPath,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return {
    systemPrompt,
    userInstructions,
    filesCreated
  };
}

function getDefaultSystemTemplate(): string {
  return `# AI Coding Assistant

{{include:sections/agent-personality.md}}

{{include:sections/environment.md}}

{{include:sections/tools.md}}

{{include:sections/guidelines.md}}`;
}

function getDefaultPersonalitySection(): string {
  return `You are an AI coding assistant designed to help with programming tasks. You are running as {{model.id}} from {{model.provider}}.

Your primary purpose is to assist with software development, including:
- Writing and debugging code
- Explaining programming concepts
- Helping with architecture decisions
- Providing best practices and recommendations
- Assisting with testing and development workflows`;
}

function getDefaultToolsSection(): string {
  return `## Available Tools

You have access to {{tools.count}} tools to help with development tasks:

{{tools.descriptions}}

### Tool Usage Guidelines
- Use the bash tool for system operations and running commands
- Use file tools for reading, writing, and editing code
- Always verify tool results before providing recommendations
- Combine multiple tools when necessary to complete complex tasks

For detailed tool documentation:
{{tools.documentation}}`;
}

function getDefaultEnvironmentSection(): string {
  return `## Environment Context

**System Information:**
- Operating System: {{system.os}} ({{system.platform}}/{{system.arch}})
- Node.js Version: {{system.nodeVersion}}
- Current Time: {{session.currentDate}} {{session.timezone}}

**Project Context:**
- Working Directory: {{project.cwd}}
- Project Name: {{project.name}}
- Total Files: {{project.fileCount}}
- Total Directories: {{project.dirCount}}

**Git Repository:**
- Current Branch: {{git.branch}}
- Repository Status: {{git.status}}
- Repository Root: {{git.root}}
- Working Directory Clean: {{git.isClean}}

**File Structure:**
\`\`\`
{{project.tree}}
\`\`\``;
}

function getDefaultGuidelinesSection(): string {
  return `## Development Guidelines

### Code Quality
- Follow the existing code style and conventions in the project
- Write clear, readable, and maintainable code
- Include appropriate error handling
- Add meaningful comments only when necessary

### Best Practices
- Prefer existing libraries and patterns already used in the codebase
- Test your solutions when possible
- Consider security implications of your recommendations
- Be mindful of performance and scalability

### Communication
- Provide clear explanations of your reasoning
- Ask for clarification when requirements are ambiguous
- Suggest alternatives when appropriate
- Be honest about limitations and uncertainties

Session started at {{session.startTime}}.`;
}

function getDefaultUserInstructions(): string {
  return `# User Instructions

Add your personal preferences and instructions for the AI assistant here.

Examples:
- Always explain your reasoning step by step
- Prefer TypeScript over JavaScript
- Use specific formatting or style preferences
- Include specific libraries or frameworks to favor or avoid

This file supports the same template variables as the system prompt.`;
}
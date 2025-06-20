// ABOUTME: Tool variable provider for available tool documentation and descriptions
// ABOUTME: Extracts tool information from ToolRegistry to provide context in prompts

import { PromptVariableProvider } from '../types.js';
import { Tool } from '../../tools/types.js';
import { logger } from '../../utils/logger.js';

export class ToolVariableProvider implements PromptVariableProvider {
  private _tools: Tool[];

  constructor(tools: Tool[]) {
    this._tools = tools;
  }

  getVariables(): Record<string, unknown> {
    return {
      tools: {
        list: this._getToolNames(),
        count: this._tools.length,
        descriptions: this._getToolDescriptions(),
        documentation: this._getToolDocumentation(),
        categories: this._getToolCategories()
      }
    };
  }

  private _getToolNames(): string[] {
    return this._tools.map(tool => tool.name);
  }

  private _getToolDescriptions(): string {
    if (this._tools.length === 0) {
      return '(no tools available)';
    }

    return this._tools
      .map(tool => `${tool.name}: ${tool.description}`)
      .join('\n');
  }

  private _getToolDocumentation(): string {
    if (this._tools.length === 0) {
      return '(no tools available)';
    }

    const sections = ['## Available Tools\n'];

    for (const tool of this._tools) {
      sections.push(`### ${tool.name}`);
      sections.push(`${tool.description}\n`);

      if (tool.input_schema) {
        try {
          const schema = this._formatSchema(tool.input_schema);
          if (schema) {
            sections.push('**Parameters:**');
            sections.push(schema);
          }
        } catch (error) {
          logger.debug('Error formatting tool schema', {
            toolName: tool.name,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      sections.push(''); // Add spacing between tools
    }

    return sections.join('\n');
  }

  private _formatSchema(schema: any): string {
    if (!schema || typeof schema !== 'object') {
      return '';
    }

    const lines: string[] = [];

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const prop = propSchema as any;
        const isRequired = schema.required && schema.required.includes(propName);
        const requiredMarker = isRequired ? ' (required)' : ' (optional)';
        
        let typeInfo = '';
        if (prop.type) {
          typeInfo = ` [${prop.type}]`;
          
          if (prop.enum) {
            typeInfo += ` (${prop.enum.join('|')})`;
          } else if (prop.minimum !== undefined || prop.maximum !== undefined) {
            const min = prop.minimum !== undefined ? `min: ${prop.minimum}` : '';
            const max = prop.maximum !== undefined ? `max: ${prop.maximum}` : '';
            const range = [min, max].filter(Boolean).join(', ');
            if (range) {
              typeInfo += ` (${range})`;
            }
          }
        }

        const description = prop.description || '(no description)';
        lines.push(`- **${propName}**${typeInfo}${requiredMarker}: ${description}`);

        // Handle nested objects
        if (prop.type === 'object' && prop.properties) {
          const nestedLines = this._formatNestedProperties(prop.properties, '  ');
          lines.push(...nestedLines);
        }

        // Handle arrays
        if (prop.type === 'array' && prop.items) {
          const itemType = prop.items.type || 'any';
          lines.push(`  - Items: ${itemType}`);
        }
      }
    }

    return lines.join('\n');
  }

  private _formatNestedProperties(properties: any, indent: string): string[] {
    const lines: string[] = [];
    
    for (const [propName, propSchema] of Object.entries(properties)) {
      const prop = propSchema as any;
      const typeInfo = prop.type ? ` [${prop.type}]` : '';
      const description = prop.description || '(no description)';
      lines.push(`${indent}- **${propName}**${typeInfo}: ${description}`);
    }

    return lines;
  }

  private _getToolCategories(): Record<string, string[]> {
    const categories: Record<string, string[]> = {
      system: [],
      files: [],
      network: [],
      data: [],
      other: []
    };

    for (const tool of this._tools) {
      const category = this._categorizeToolBranch(tool.name);
      categories[category].push(tool.name);
    }

    // Remove empty categories
    for (const [category, tools] of Object.entries(categories)) {
      if (tools.length === 0) {
        delete categories[category];
      }
    }

    return categories;
  }

  private _categorizeToolBranch(toolName: string): string {
    const name = toolName.toLowerCase();
    
    if (name.includes('bash') || name.includes('shell') || name.includes('exec')) {
      return 'system';
    }
    
    if (name.includes('file') || name.includes('read') || name.includes('write') || name.includes('edit')) {
      return 'files';
    }
    
    if (name.includes('http') || name.includes('api') || name.includes('fetch') || name.includes('url')) {
      return 'network';
    }
    
    if (name.includes('json') || name.includes('csv') || name.includes('data') || name.includes('parse')) {
      return 'data';
    }
    
    return 'other';
  }
}
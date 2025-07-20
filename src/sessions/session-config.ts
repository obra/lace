// ABOUTME: Session and agent configuration schemas with validation and preset management
// ABOUTME: Provides rich configuration options with hierarchical inheritance and validation

import { z } from 'zod';

export const SessionConfigurationSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'lmstudio', 'ollama']).optional(),
  model: z.string().optional(),
  maxTokens: z.number().positive().max(100000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional(),
  toolPolicies: z.record(z.enum(['allow', 'require-approval', 'deny'])).optional(),
  workingDirectory: z.string().optional(),
  environmentVariables: z.record(z.string()).optional(),
  promptTemplate: z.string().optional(),
  specialInstructions: z.string().optional(),
});

export const AgentConfigurationSchema = SessionConfigurationSchema.extend({
  role: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  restrictions: z.array(z.string()).optional(),
  memorySize: z.number().positive().optional(),
  conversationHistory: z.number().positive().optional(),
});

export type SessionConfiguration = z.infer<typeof SessionConfigurationSchema>;
export type AgentConfiguration = z.infer<typeof AgentConfigurationSchema>;

export interface ConfigurationPreset {
  id: string;
  name: string;
  description: string;
  configuration: SessionConfiguration;
  isDefault?: boolean;
}

export class ConfigurationPresetManager {
  private presets = new Map<string, ConfigurationPreset>();

  savePreset(
    id: string,
    config: Partial<SessionConfiguration>,
    metadata?: {
      name?: string;
      description?: string;
      isDefault?: boolean;
    }
  ): void {
    try {
      const preset: ConfigurationPreset = {
        id,
        name: metadata?.name || id,
        description: metadata?.description || '',
        configuration: SessionConfigurationSchema.parse(config),
        isDefault: metadata?.isDefault || false,
      };

      this.presets.set(id, preset);
    } catch (error) {
      throw new Error(
        `Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  getPreset(id: string): ConfigurationPreset | undefined {
    return this.presets.get(id);
  }

  getPresets(): ConfigurationPreset[] {
    return Array.from(this.presets.values());
  }

  getDefaultPreset(): ConfigurationPreset | undefined {
    return Array.from(this.presets.values()).find((p) => p.isDefault);
  }

  deletePreset(id: string): boolean {
    return this.presets.delete(id);
  }
}

export class ConfigurationValidator {
  static validateSessionConfiguration(config: unknown): SessionConfiguration {
    try {
      return SessionConfigurationSchema.parse(config);
    } catch (error) {
      throw new Error(
        `Configuration validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  static validateAgentConfiguration(config: unknown): AgentConfiguration {
    try {
      return AgentConfigurationSchema.parse(config);
    } catch (error) {
      throw new Error(
        `Agent configuration validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  static mergeConfigurations(
    base: SessionConfiguration,
    override: Partial<SessionConfiguration>
  ): SessionConfiguration {
    const merged = { ...base, ...override };

    // Special handling for nested objects
    if (base.toolPolicies || override.toolPolicies) {
      merged.toolPolicies = { ...base.toolPolicies, ...override.toolPolicies };
    }

    if (base.environmentVariables || override.environmentVariables) {
      merged.environmentVariables = {
        ...base.environmentVariables,
        ...override.environmentVariables,
      };
    }

    return SessionConfigurationSchema.parse(merged);
  }
}

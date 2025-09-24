// ABOUTME: Utility functions for provider operations
// ABOUTME: Model string parsing and validation helpers

import { UserSettingsManager } from '~/config/user-settings';

interface ParsedProviderModel {
  instanceId: string;
  modelId: string;
}

export function parseProviderModel(modelString: string): ParsedProviderModel {
  if (!modelString || typeof modelString !== 'string') {
    throw new Error('Invalid model format. Expected "provider:model"');
  }

  const colonIndex = modelString.indexOf(':');
  if (colonIndex === -1) {
    throw new Error('Invalid model format. Expected "provider:model"');
  }

  const provider = modelString.substring(0, colonIndex);
  const model = modelString.substring(colonIndex + 1);

  if (!provider || !model) {
    throw new Error('Invalid model format. Expected "provider:model"');
  }

  return {
    instanceId: provider,
    modelId: model,
  };
}

export interface ResolvedModel {
  providerInstanceId: string;
  modelId: string;
}

export interface ModelResolutionContext {
  providerInstanceId?: string;
  modelId?: string;
}

/**
 * Resolves a model specification to concrete provider instance and model IDs.
 *
 * @param spec - The model specification:
 *   - undefined: Use context defaults
 *   - 'fast' | 'smart': Use system-configured fast/smart model
 *   - 'instanceId:modelId': Direct specification
 * @param context - Optional context with default provider/model
 * @returns Resolved provider instance and model IDs
 * @throws Error if unable to resolve
 */
export function resolveModelSpec(spec?: string, context?: ModelResolutionContext): ResolvedModel {
  // No spec - use context defaults
  if (spec === undefined) {
    if (!context?.providerInstanceId || !context?.modelId) {
      throw new Error('No model spec provided and context has no defaults');
    }
    return {
      providerInstanceId: context.providerInstanceId,
      modelId: context.modelId,
    };
  }

  // Empty string is invalid
  if (spec === '') {
    throw new Error(
      `Invalid model spec: '${spec}'. Expected 'fast', 'smart', or 'instanceId:modelId'`
    );
  }

  // Speed tier - lookup from user settings
  if (spec === 'fast' || spec === 'smart') {
    const modelString = UserSettingsManager.getDefaultModel(spec);
    const parsed = parseProviderModel(modelString);
    return {
      providerInstanceId: parsed.instanceId,
      modelId: parsed.modelId,
    };
  }

  // Direct specification - must contain colon
  if (spec.includes(':')) {
    const parsed = parseProviderModel(spec);
    return {
      providerInstanceId: parsed.instanceId,
      modelId: parsed.modelId,
    };
  }

  throw new Error(
    `Invalid model spec: '${spec}'. Expected 'fast', 'smart', or 'instanceId:modelId'`
  );
}

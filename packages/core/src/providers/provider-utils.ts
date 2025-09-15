// ABOUTME: Utility functions for provider operations
// ABOUTME: Model string parsing and validation helpers

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

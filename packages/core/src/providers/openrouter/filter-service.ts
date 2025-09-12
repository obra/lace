// ABOUTME: Service for filtering OpenRouter models based on user configuration
// ABOUTME: Applies provider, model, capability, cost, and context length filters

import type { OpenRouterModel } from './types';
import type { ModelConfig } from '../catalog/types';
import { extractProvider, convertPricing } from './utils';

export class ModelFilterService {
  filterModels(models: OpenRouterModel[], config: ModelConfig): OpenRouterModel[] {
    const startCount = models.length;

    const filtered = models.filter((model) => {
      // Check disabled providers
      const provider = extractProvider(model.id);
      if (config.disabledProviders?.includes(provider)) {
        return false;
      }

      // Check disabled models
      if (config.disabledModels?.includes(model.id)) {
        return false;
      }

      // Apply filters if present
      if (config.filters) {
        const filters = config.filters;

        // Required parameters check
        if (filters.requiredParameters?.length) {
          const hasAll = filters.requiredParameters.every((param) =>
            model.supported_parameters?.includes(param)
          );
          if (!hasAll) return false;
        }

        // Cost filters
        if (filters.maxPromptCostPerMillion !== undefined) {
          const cost = convertPricing(model.pricing.prompt);
          if (cost > filters.maxPromptCostPerMillion) return false;
        }

        if (filters.maxCompletionCostPerMillion !== undefined) {
          const cost = convertPricing(model.pricing.completion);
          if (cost > filters.maxCompletionCostPerMillion) return false;
        }

        // Context length filter
        if (filters.minContextLength !== undefined) {
          if (model.context_length < filters.minContextLength) return false;
        }
      }

      return true;
    });

    return filtered;
  }

  // Group models by provider
  groupByProvider(models: OpenRouterModel[]): Map<string, OpenRouterModel[]> {
    const groups = new Map<string, OpenRouterModel[]>();

    for (const model of models) {
      const provider = extractProvider(model.id);
      const group = groups.get(provider) ?? [];
      group.push(model);
      groups.set(provider, group);
    }

    return groups;
  }
}

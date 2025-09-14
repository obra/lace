// ABOUTME: API endpoint to update model configuration for a provider instance
// ABOUTME: Saves filtering settings like disabled models, required capabilities, etc.

import type { Route } from './+types/api.provider.instances.$instanceId.config';
import { createSuperjsonResponse } from '@/lib/server/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { ProviderRegistry, ModelConfigSchema } from '@/lib/server/lace-imports';
import { logger } from '~/utils/logger';

export async function action({ params, request }: Route.ActionArgs) {
  try {
    const { instanceId } = params;

    if (request.method !== 'PATCH') {
      return createErrorResponse('Method not allowed', 405);
    }

    // Parse request body
    const body = (await request.json()) as { modelConfig: unknown };

    // Validate model config
    const parseResult = ModelConfigSchema.safeParse(body.modelConfig);
    if (!parseResult.success) {
      return createErrorResponse('Invalid model configuration', 400, {
        error: parseResult.error.errors,
      });
    }

    // Get instance manager
    const registry = ProviderRegistry.getInstance();
    const instanceManager = registry.getInstanceManager();

    // Load current instances
    const instances = await instanceManager.loadInstances();
    const instance = instances.instances[instanceId];

    if (!instance) {
      return createErrorResponse(`Instance not found: ${instanceId}`, 404);
    }

    // Update the instance with new model config
    instances.instances[instanceId] = {
      ...instance,
      modelConfig: parseResult.data,
    };

    // Save updated configuration
    await instanceManager.saveInstances(instances);

    logger.info('Model config updated', {
      instanceId,
      disabledModels: parseResult.data.disabledModels?.length ?? 0,
      disabledProviders: parseResult.data.disabledProviders?.length ?? 0,
    });

    return createSuperjsonResponse({
      success: true,
      message: 'Configuration saved successfully',
    });
  } catch (error: unknown) {
    logger.error('Failed to update model config', { error });
    const errorMessage = error instanceof Error ? error.message : 'Failed to update configuration';
    return createErrorResponse(errorMessage, 500);
  }
}

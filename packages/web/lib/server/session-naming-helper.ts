// ABOUTME: Session naming helper using InfrastructureHelper for AI-generated session names
// ABOUTME: Takes project name and user input, returns brief descriptive session name

import { InfrastructureHelper } from './lace-imports';

export async function generateSessionName(
  projectName: string,
  userInput: string,
  fallbackModel?: { providerInstanceId: string; modelId: string }
): Promise<string> {
  let model: 'fast' | 'smart' = 'fast';
  let providerInstanceId: string | undefined;
  let modelId: string | undefined;

  // Try to use 'fast' model first, fall back to session model if global config missing
  if (fallbackModel) {
    providerInstanceId = fallbackModel.providerInstanceId;
    modelId = fallbackModel.modelId;
  }

  const helper = new InfrastructureHelper({
    model,
    tools: [],
    ...(providerInstanceId &&
      modelId && {
        providerInstanceId,
        modelId,
      }),
  });

  const result = await helper.execute(
    `Here's the project name: '${projectName}'. Here's what the user wrote: '${userInput}'. Return a brief descriptive name for this session. No more than 5 words.`
  );

  return result.content.trim();
}

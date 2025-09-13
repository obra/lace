// ABOUTME: Session naming helper using InfrastructureHelper for AI-generated session names
// ABOUTME: Takes project name and user input, returns brief descriptive session name

import { InfrastructureHelper } from './lace-imports';
import type { AIProvider } from './lace-imports';

export async function generateSessionName(
  projectName: string,
  userInput: string,
  fallbackModel?: { provider: AIProvider; modelId: string }
): Promise<string> {
  const helper = new InfrastructureHelper({
    model: 'fast', // Prefer 'fast' model tier if available
    tools: [],
    fallbackProvider: fallbackModel?.provider,
    fallbackModelId: fallbackModel?.modelId,
  });

  const result = await helper.execute(
    `Here's the project name: '${projectName}'. Here's what the user wrote: '${userInput}'. Return a brief descriptive name for this session. No more than 5 words.`
  );

  return result.content.trim();
}

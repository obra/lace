// ABOUTME: Session naming helper that uses the agent via ENT JSON-RPC
// ABOUTME: Takes project name + user input and returns a short session title

import { getProviderManagementAgent, getSupervisor } from './supervisor-service';
import { configureAgentSession } from './agent-session-config';

export async function generateSessionName(
  projectName: string,
  userInput: string,
  fallbackModel?: { connectionId: string; modelId: string }
): Promise<string> {
  const supervisor = await getSupervisor();
  const mgmt = await getProviderManagementAgent();

  if (fallbackModel) {
    await configureAgentSession(supervisor.agentRequest.bind(supervisor), {
      workspaceSessionId: mgmt.workspaceSessionId,
      sessionId: mgmt.agentSessionId,
      connectionId: fallbackModel.connectionId,
      modelId: fallbackModel.modelId,
      approvalMode: 'ask',
    });
  }

  type PromptResult = {
    content: Array<{ type: string; text?: string }>;
    structuredOutput?: unknown;
  };

  const prompt = `Here's the project name: '${projectName}'. Here's what the user wrote: '${userInput}'. Return a brief descriptive name for this session. No more than 5 words.`;

  const result = (await supervisor.agentRequest({
    workspaceSessionId: mgmt.workspaceSessionId,
    sessionId: mgmt.agentSessionId,
    method: 'session/prompt',
    requestParams: {
      content: [{ type: 'text', text: prompt }],
      maxTurns: 1,
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: { title: { type: 'string' } },
        },
      },
    },
  })) as PromptResult;

  const titleFromStructured = (() => {
    const so = result.structuredOutput;
    if (!so || typeof so !== 'object') return undefined;
    const title = (so as { title?: unknown }).title;
    return typeof title === 'string' ? title : undefined;
  })();

  if (titleFromStructured) return titleFromStructured.trim();

  const titleFromContent = result.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ')
    .trim();

  return titleFromContent;
}

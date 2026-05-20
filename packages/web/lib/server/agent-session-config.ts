// ABOUTME: Shared supervisor RPC helpers for configuring Lace agent sessions
// ABOUTME: Keeps Ent-owned provider connection separate from ACP session config options

type AgentRequestFn = (params: {
  workspaceSessionId: string;
  sessionId?: string;
  method: string;
  requestParams?: unknown;
}) => Promise<unknown>;

export type ApprovalMode =
  | 'ask'
  | 'approveReads'
  | 'approveEdits'
  | 'approve'
  | 'deny'
  | 'dangerouslySkipPermissions';

export async function configureAgentSession(
  agentRequest: AgentRequestFn,
  params: {
    workspaceSessionId: string;
    sessionId: string;
    connectionId?: string;
    modelId?: string;
    approvalMode?: ApprovalMode;
  }
): Promise<void> {
  const { workspaceSessionId, sessionId, connectionId, modelId, approvalMode } = params;

  if (connectionId) {
    await agentRequest({
      workspaceSessionId,
      sessionId,
      method: 'ent/session/configure',
      requestParams: { connectionId },
    });
  }

  if (modelId) {
    await agentRequest({
      workspaceSessionId,
      sessionId,
      method: 'session/set_config_option',
      requestParams: { sessionId, configId: 'model', value: modelId },
    });
  }

  if (approvalMode) {
    await agentRequest({
      workspaceSessionId,
      sessionId,
      method: 'session/set_config_option',
      requestParams: { sessionId, configId: 'approvalMode', value: approvalMode },
    });
  }
}

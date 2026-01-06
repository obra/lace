import { z } from 'zod';
import { SessionIdSchema } from '../ids';
import { JsonRpcIdSchema, JsonRpcVersionSchema } from './jsonrpc';
import {
  ConnectionInfoSchema,
  ContentBlockSchema,
  IsoTimestampSchema,
  McpServerConfigSchema,
  McpServerStatusSchema,
  ModelInfoSchema,
  NonEmptyStringSchema,
  PermissionOptionSchema,
  PermissionRequestSchema,
  PersonaInfoSchema,
  ProviderInfoSchema,
  SandboxConfigSchema,
  ToolInfoSchema,
  ToolResultSchema,
  UsageInfoSchema,
} from './shared';

const EmptyParamsSchema = z.object({}).strict();

const ClientCapabilitiesSchema = z
  .object({
    streaming: z.boolean().optional(),
    permissions: z.boolean().optional(),
    images: z.boolean().optional(),
    fileSystem: z.literal(false).optional(),
    terminal: z.literal(false).optional(),
    'ent/contextInjection': z.boolean().optional(),
    'ent/backgroundJobs': z.boolean().optional(),
    'ent/jobStreaming': z.enum(['full', 'coalesced', 'none']).optional(),
  })
  .strict();

const SlashCommandSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: z.string(),
    inputHint: z.string().optional(),
  })
  .strict();

const AgentCapabilitiesSchema = z
  .object({
    streaming: z.boolean(),
    multiTurn: z.boolean(),
    session: z
      .object({
        fork: z.object({}).optional(),
        resume: z.object({}).optional(),
      })
      .strict()
      .optional(),
    modes: z.array(NonEmptyStringSchema).optional(),
    tools: z.array(ToolInfoSchema),
    operations: z
      .object({
        compact: z.boolean().optional(),
        checkpoint: z.boolean().optional(),
        rewind: z.boolean().optional(),
        configure: z.boolean().optional(),
      })
      .strict()
      .optional(),
    slashCommands: z.array(SlashCommandSchema).optional(),
    'ent/contextInjection': z.boolean(),
    'ent/backgroundJobs': z.boolean(),
    'ent/fileCheckpointing': z.boolean(),
    'ent/structuredOutput': z.boolean(),
    'ent/providers': z
      .object({
        list: z.boolean(),
        connections: z.boolean(),
        models: z.boolean(),
        catalogRefresh: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const InitializeParamsSchema = z
  .object({
    protocolVersion: z.literal('1.0'),
    clientInfo: z
      .object({
        name: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
      })
      .strict(),
    capabilities: ClientCapabilitiesSchema,
    config: z
      .object({
        providerId: z.string().optional(),
        connectionId: z.string().optional(),
        modelId: z.string().optional(),
        executionMode: z.enum(['plan', 'execute']).optional(),
        approvalMode: z
          .enum([
            'ask',
            'approveReads',
            'approveEdits',
            'approve',
            'deny',
            'dangerouslySkipPermissions',
          ])
          .optional(),
        mcpServers: z.array(McpServerConfigSchema).optional(),
        maxBudgetUsd: z.number().optional(),
        maxThinkingTokens: z.number().optional(),
        enableFileCheckpointing: z.boolean().optional(),
        sandbox: SandboxConfigSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type InitializeParams = z.infer<typeof InitializeParamsSchema>;

const InitializeResultSchema = z
  .object({
    protocolVersion: z.literal('1.0'),
    agentInfo: z
      .object({
        name: NonEmptyStringSchema,
        version: NonEmptyStringSchema,
      })
      .strict(),
    capabilities: AgentCapabilitiesSchema,
  })
  .strict();
export type InitializeResult = z.infer<typeof InitializeResultSchema>;

export const InitializeRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('initialize'),
    params: InitializeParamsSchema,
  })
  .strict();

export const InitializeResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: InitializeResultSchema,
  })
  .strict();

const SessionNewParamsSchema = z
  .object({
    workDir: NonEmptyStringSchema,
    persona: NonEmptyStringSchema.optional(),
    systemPrompt: z
      .union([
        z.string(),
        z
          .object({
            type: z.literal('preset'),
            preset: NonEmptyStringSchema,
            append: z.string().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

const SessionNewResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    created: IsoTimestampSchema,
  })
  .strict();

export const SessionNewRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/new'),
    params: SessionNewParamsSchema,
  })
  .strict();

export const SessionNewResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionNewResultSchema,
  })
  .strict();

const SessionLoadParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
  })
  .strict();

// ACP-aligned: lastActive renamed to updatedAt
const SessionLoadResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    forkedFrom: SessionIdSchema.optional(),
    messageCount: z.number(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const SessionLoadRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/load'),
    params: SessionLoadParamsSchema,
  })
  .strict();

export const SessionLoadResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionLoadResultSchema,
  })
  .strict();

export const SessionForkParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    cwd: NonEmptyStringSchema.optional(),
    mcpServers: z.array(McpServerConfigSchema).optional(),
  })
  .strict();

export const SessionForkResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    forkedFrom: SessionIdSchema,
    messageCount: z.number(),
    updatedAt: IsoTimestampSchema,
  })
  .strict();

export const SessionForkRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/fork'),
    params: SessionForkParamsSchema,
  })
  .strict();

export const SessionForkResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionForkResultSchema,
  })
  .strict();

// ACP-aligned: workDir renamed to cwd, added cursor for pagination
const SessionListParamsSchema = z
  .object({
    cwd: NonEmptyStringSchema.optional(),
    cursor: NonEmptyStringSchema.optional(),
  })
  .strict();

// ACP-aligned: workDir→cwd, lastActive→updatedAt, added title/_meta/nextCursor
const SessionListResultSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: SessionIdSchema,
          cwd: NonEmptyStringSchema,
          title: z.string().optional(),
          updatedAt: IsoTimestampSchema,
          created: IsoTimestampSchema, // Ent extension
          messageCount: z.number(), // Ent extension
          _meta: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
    ),
    nextCursor: NonEmptyStringSchema.optional(),
  })
  .strict();

export const SessionListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/list'),
    params: SessionListParamsSchema.optional(),
  })
  .strict();

export const SessionListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionListResultSchema,
  })
  .strict();

const SessionSetModeParamsSchema = z
  .object({
    mode: z.enum(['plan', 'execute']),
  })
  .strict();

const SessionSetModeResultSchema = z
  .object({
    mode: z.string(),
    previousMode: z.string(),
  })
  .strict();

export const SessionSetModeRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/set_mode'),
    params: SessionSetModeParamsSchema,
  })
  .strict();

export const SessionSetModeResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionSetModeResultSchema,
  })
  .strict();

const SessionPromptParamsSchema = z
  .object({
    content: z.array(ContentBlockSchema),
    maxTurns: z.number().optional(),
    outputFormat: z
      .object({
        type: z.literal('json_schema'),
        schema: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

const SessionPromptResultSchema = z
  .object({
    turnId: NonEmptyStringSchema,
    stopReason: z.enum(['end_turn', 'max_tokens', 'max_turns', 'cancelled', 'budget_exceeded']),
    content: z.array(ContentBlockSchema),
    usage: UsageInfoSchema,
    structuredOutput: z.unknown().optional(),
    cost: z
      .object({
        inputCostUsd: z.number(),
        outputCostUsd: z.number(),
        totalCostUsd: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const SessionPromptRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/prompt'),
    params: SessionPromptParamsSchema,
  })
  .strict();

export const SessionPromptResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionPromptResultSchema,
  })
  .strict();

const CancelRequestParamsSchema = z
  .object({
    requestId: JsonRpcIdSchema,
  })
  .strict();

export const CancelRequestNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('$/cancel_request'),
    params: CancelRequestParamsSchema,
  })
  .strict();

const EntAgentPingResultSchema = z
  .object({
    ok: z.literal(true),
    timestamp: IsoTimestampSchema,
  })
  .strict();

export const EntAgentPingRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/agent/ping'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntAgentPingResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntAgentPingResultSchema,
  })
  .strict();

const EntAgentStatusResultSchema = z
  .object({
    models: z.array(ModelInfoSchema),
    mcpServers: z.array(McpServerStatusSchema),
    currentSession: z
      .object({
        sessionId: SessionIdSchema,
        messageCount: z.number(),
        tokensUsed: z.number(),
        costUsd: z.number(),
        providerId: z.string().optional(),
        connectionId: z.string().optional(),
        modelId: z.string().optional(),
      })
      .strict()
      .optional(),
    currentTurn: z
      .object({
        turnId: NonEmptyStringSchema,
        status: z.enum(['running', 'awaiting_permission', 'awaiting_input']),
        startedAt: IsoTimestampSchema,
      })
      .strict()
      .optional(),
    pendingPermissions: z.array(PermissionRequestSchema),
    limits: z
      .object({
        maxBudgetUsd: z.number().optional(),
        budgetUsedUsd: z.number(),
        maxTurns: z.number().optional(),
      })
      .strict(),
  })
  .strict();

export const EntAgentStatusRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/agent/status'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntAgentStatusResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntAgentStatusResultSchema,
  })
  .strict();

const EntSessionCompactParamsSchema = z
  .object({
    strategy: z.enum(['summarize', 'truncate', 'selective']).optional(),
    targetTokens: z.number().optional(),
    preserveRecent: z.number().optional(),
  })
  .strict();

const EntSessionCompactResultSchema = z
  .object({
    previousTokens: z.number(),
    currentTokens: z.number(),
    messagesCompacted: z.number(),
    summary: z.string().optional(),
  })
  .strict();

export const EntSessionCompactRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/compact'),
    params: EntSessionCompactParamsSchema.optional(),
  })
  .strict();

export const EntSessionCompactResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionCompactResultSchema,
  })
  .strict();

const EntSessionConfigureParamsSchema = z
  .object({
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
    maxThinkingTokens: z.number().optional(),
    maxBudgetUsd: z.number().optional(),
    mcpServers: z.array(McpServerConfigSchema).optional(),
    approvalMode: z
      .enum([
        'ask',
        'approveReads',
        'approveEdits',
        'approve',
        'deny',
        'dangerouslySkipPermissions',
      ])
      .optional(),
  })
  .strict();

const EntSessionConfigureResultSchema = z
  .object({
    applied: z.array(z.string()),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();

export const EntSessionConfigureRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/configure'),
    params: EntSessionConfigureParamsSchema,
  })
  .strict();

export const EntSessionConfigureResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionConfigureResultSchema,
  })
  .strict();

const EntSessionRewindParamsSchema = z
  .object({
    toEventSeq: z.number(),
  })
  .strict();

const EntSessionRewindResultSchema = z
  .object({
    filesRestored: z.array(z.string()),
    eventSeq: z.number(),
  })
  .strict();

export const EntSessionRewindRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/rewind'),
    params: EntSessionRewindParamsSchema,
  })
  .strict();

export const EntSessionRewindResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionRewindResultSchema,
  })
  .strict();

const EntSessionCheckpointParamsSchema = z
  .object({
    label: z.string().optional(),
  })
  .strict();

const EntSessionCheckpointResultSchema = z
  .object({
    checkpointId: NonEmptyStringSchema,
    eventSeq: z.number(),
    files: z.array(z.string()),
  })
  .strict();

export const EntSessionCheckpointRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/checkpoint'),
    params: EntSessionCheckpointParamsSchema.optional(),
  })
  .strict();

export const EntSessionCheckpointResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionCheckpointResultSchema,
  })
  .strict();

const EntSessionInjectParamsSchema = z
  .object({
    content: z.array(ContentBlockSchema),
    priority: z.enum(['immediate', 'normal', 'deferred']),
  })
  .strict();

export const EntSessionInjectNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('ent/session/inject'),
    params: EntSessionInjectParamsSchema,
  })
  .strict();

const EntSessionEventsParamsSchema = z
  .object({
    afterEventSeq: z.number().optional(),
    limit: z.number().optional(),
    types: z.array(z.string()).optional(),
  })
  .strict();

const EntSessionEventsResultSchema = z
  .object({
    events: z.array(
      z
        .object({
          eventSeq: z.number(),
          timestamp: IsoTimestampSchema,
          turnId: NonEmptyStringSchema.optional(),
          turnSeq: z.number().optional(),
          type: NonEmptyStringSchema,
          data: z.record(z.string(), z.unknown()),
        })
        .strict()
    ),
    hasMore: z.boolean(),
  })
  .strict();

export const EntSessionEventsRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/events'),
    params: EntSessionEventsParamsSchema.optional(),
  })
  .strict();

export const EntSessionEventsResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionEventsResultSchema,
  })
  .strict();

const EntProvidersListResultSchema = z
  .object({
    providers: z.array(ProviderInfoSchema),
  })
  .strict();

export const EntProvidersListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/providers/list'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntProvidersListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntProvidersListResultSchema,
  })
  .strict();

const EntConnectionsListParamsSchema = z
  .object({
    providerId: z.string().optional(),
  })
  .strict();

const EntConnectionsListResultSchema = z
  .object({
    connections: z.array(ConnectionInfoSchema),
  })
  .strict();

export const EntConnectionsListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/list'),
    params: EntConnectionsListParamsSchema.optional(),
  })
  .strict();

export const EntConnectionsListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsListResultSchema,
  })
  .strict();

const EntConnectionsUpsertParamsSchema = z
  .object({
    providerId: z.string().optional(),
    connection: z
      .object({
        connectionId: z.string().optional(),
        name: NonEmptyStringSchema,
        config: z.record(z.string(), z.unknown()),
      })
      .strict(),
  })
  .strict();

const EntConnectionsUpsertResultSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    providerId: NonEmptyStringSchema,
    created: z.boolean(),
  })
  .strict();

export const EntConnectionsUpsertRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/upsert'),
    params: EntConnectionsUpsertParamsSchema,
  })
  .strict();

export const EntConnectionsUpsertResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsUpsertResultSchema,
  })
  .strict();

const EntConnectionsDeleteParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
  })
  .strict();

const OkTrueResultSchema = z.object({ ok: z.literal(true) }).strict();

export const EntConnectionsDeleteRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/delete'),
    params: EntConnectionsDeleteParamsSchema,
  })
  .strict();

export const EntConnectionsDeleteResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: OkTrueResultSchema,
  })
  .strict();

const EntConnectionsTestParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    modelId: z.string().optional(),
  })
  .strict();

const EntConnectionsTestResultSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
  })
  .strict();

export const EntConnectionsTestRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/test'),
    params: EntConnectionsTestParamsSchema,
  })
  .strict();

export const EntConnectionsTestResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsTestResultSchema,
  })
  .strict();

const EntConnectionsCredentialsStatusParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
  })
  .strict();

const EntConnectionsCredentialsStatusResultSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    state: z.enum(['ready', 'missing', 'expired', 'invalid', 'unknown']),
    accountLabel: z.string().optional(),
    expiresAt: IsoTimestampSchema.optional(),
  })
  .strict();

export const EntConnectionsCredentialsStatusRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/credentials/status'),
    params: EntConnectionsCredentialsStatusParamsSchema,
  })
  .strict();

export const EntConnectionsCredentialsStatusResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsCredentialsStatusResultSchema,
  })
  .strict();

const EntConnectionsCredentialsStartParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    method: z.enum(['api_key', 'device_code', 'browser', 'token']).optional(),
  })
  .strict();

const CredentialNeedsInputResultSchema = z
  .object({
    kind: z.literal('needs_input'),
    fields: z.array(
      z
        .object({
          name: NonEmptyStringSchema,
          label: z.string().optional(),
          secret: z.boolean(),
          hint: z.string().optional(),
        })
        .strict()
    ),
  })
  .strict();

const CredentialDeviceCodeResultSchema = z
  .object({
    kind: z.literal('device_code'),
    verificationUri: NonEmptyStringSchema,
    userCode: NonEmptyStringSchema,
    expiresAt: IsoTimestampSchema,
  })
  .strict();

const CredentialBrowserResultSchema = z
  .object({
    kind: z.literal('browser'),
    url: NonEmptyStringSchema,
  })
  .strict();

const CredentialReadyResultSchema = z.object({ kind: z.literal('ready') }).strict();

const EntConnectionsCredentialsStartResultSchema = z.union([
  CredentialNeedsInputResultSchema,
  CredentialDeviceCodeResultSchema,
  CredentialBrowserResultSchema,
  CredentialReadyResultSchema,
]);

export const EntConnectionsCredentialsStartRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/credentials/start'),
    params: EntConnectionsCredentialsStartParamsSchema,
  })
  .strict();

export const EntConnectionsCredentialsStartResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsCredentialsStartResultSchema,
  })
  .strict();

const EntConnectionsCredentialsSubmitParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    values: z.record(z.string(), z.string()),
  })
  .strict();

const EntConnectionsCredentialsSubmitResultSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), error: z.string() }).strict(),
]);

export const EntConnectionsCredentialsSubmitRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/credentials/submit'),
    params: EntConnectionsCredentialsSubmitParamsSchema,
  })
  .strict();

export const EntConnectionsCredentialsSubmitResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntConnectionsCredentialsSubmitResultSchema,
  })
  .strict();

const EntConnectionsCredentialsClearParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
  })
  .strict();

export const EntConnectionsCredentialsClearRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/connections/credentials/clear'),
    params: EntConnectionsCredentialsClearParamsSchema,
  })
  .strict();

export const EntConnectionsCredentialsClearResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: OkTrueResultSchema,
  })
  .strict();

const EntModelsListParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
  })
  .strict();

const EntModelsListResultSchema = z
  .object({
    providerId: NonEmptyStringSchema,
    connectionId: NonEmptyStringSchema,
    models: z.array(ModelInfoSchema),
  })
  .strict();

export const EntModelsListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/models/list'),
    params: EntModelsListParamsSchema,
  })
  .strict();

export const EntModelsListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntModelsListResultSchema,
  })
  .strict();

const EntModelsRefreshParamsSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
  })
  .strict();

const EntModelsRefreshResultSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    refreshedAt: IsoTimestampSchema,
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

export const EntModelsRefreshRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/models/refresh'),
    params: EntModelsRefreshParamsSchema,
  })
  .strict();

export const EntModelsRefreshResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntModelsRefreshResultSchema,
  })
  .strict();

const EntJobListResultSchema = z
  .object({
    jobs: z.array(
      z
        .object({
          jobId: NonEmptyStringSchema,
          parentJobId: NonEmptyStringSchema.optional(),
          type: z.enum(['shell', 'subagent']),
          status: z.enum(['running', 'completed', 'failed', 'cancelled']),
          description: z.string().optional(),
          command: z.string().optional(),
          startTime: IsoTimestampSchema,
          parentToolUseId: NonEmptyStringSchema.optional(),
        })
        .strict()
    ),
  })
  .strict();

export const EntJobListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/job/list'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntJobListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntJobListResultSchema,
  })
  .strict();

const EntJobOutputParamsSchema = z
  .object({
    jobId: NonEmptyStringSchema,
    block: z.boolean().optional(),
    timeout: z.number().optional(),
    tailBytes: z.number().optional(),
    afterOffset: z.number().optional(),
  })
  .strict();

const EntJobOutputResultSchema = z
  .object({
    status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    output: z.string(),
    exitCode: z.number().optional(),
    outputMeta: z
      .object({
        totalBytes: z.number(),
        returnedOffset: z.number(),
        returnedBytes: z.number(),
        truncated: z.boolean(),
      })
      .strict()
      .optional(),
    report: z
      .object({
        summary: z.string(),
        artifacts: z.array(z.string()).optional(),
        error: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const EntJobOutputRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/job/output'),
    params: EntJobOutputParamsSchema,
  })
  .strict();

export const EntJobOutputResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntJobOutputResultSchema,
  })
  .strict();

const EntJobKillParamsSchema = z
  .object({
    jobId: NonEmptyStringSchema,
  })
  .strict();

const EntJobKillResultSchema = z.object({ success: z.boolean() }).strict();

export const EntJobKillRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/job/kill'),
    params: EntJobKillParamsSchema,
  })
  .strict();

export const EntJobKillResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntJobKillResultSchema,
  })
  .strict();

// ent/tools/list - List available tools
const EntToolsListResultSchema = z
  .object({
    tools: z.array(ToolInfoSchema),
  })
  .strict();

export const EntToolsListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/tools/list'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntToolsListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntToolsListResultSchema,
  })
  .strict();

// ent/personas/list - List available personas
const EntPersonasListResultSchema = z
  .object({
    personas: z.array(PersonaInfoSchema),
  })
  .strict();

export const EntPersonasListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/personas/list'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntPersonasListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntPersonasListResultSchema,
  })
  .strict();

// ent/mcp/servers/list - List configured MCP servers
const EntMcpServersListResultSchema = z
  .object({
    servers: z.array(
      z
        .object({
          serverId: NonEmptyStringSchema,
          name: NonEmptyStringSchema,
          command: NonEmptyStringSchema,
          args: z.array(z.string()).optional(),
          enabled: z.boolean(),
          status: z.enum(['stopped', 'starting', 'running', 'failed']),
          lastError: z.string().optional(),
          connectedAt: IsoTimestampSchema.optional(),
          toolCount: z.number().optional(),
        })
        .strict()
    ),
  })
  .strict();

export const EntMcpServersListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/mcp/servers/list'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntMcpServersListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntMcpServersListResultSchema,
  })
  .strict();

// ent/mcp/servers/upsert - Add or update an MCP server config
const EntMcpServersUpsertParamsSchema = z
  .object({
    serverId: NonEmptyStringSchema.optional(),
    name: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
  })
  .strict();

const EntMcpServersUpsertResultSchema = z
  .object({
    serverId: NonEmptyStringSchema,
    created: z.boolean(),
  })
  .strict();

export const EntMcpServersUpsertRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/mcp/servers/upsert'),
    params: EntMcpServersUpsertParamsSchema,
  })
  .strict();

export const EntMcpServersUpsertResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntMcpServersUpsertResultSchema,
  })
  .strict();

// ent/mcp/servers/delete - Remove an MCP server config
const EntMcpServersDeleteParamsSchema = z
  .object({
    serverId: NonEmptyStringSchema,
  })
  .strict();

export const EntMcpServersDeleteRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/mcp/servers/delete'),
    params: EntMcpServersDeleteParamsSchema,
  })
  .strict();

export const EntMcpServersDeleteResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: OkTrueResultSchema,
  })
  .strict();

// ent/mcp/servers/test - Test an MCP server connection
const EntMcpServersTestParamsSchema = z
  .object({
    serverId: NonEmptyStringSchema,
  })
  .strict();

const EntMcpServersTestResultSchema = z
  .object({
    ok: z.boolean(),
    error: z.string().optional(),
    latencyMs: z.number().optional(),
    toolCount: z.number().optional(),
  })
  .strict();

export const EntMcpServersTestRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/mcp/servers/test'),
    params: EntMcpServersTestParamsSchema,
  })
  .strict();

export const EntMcpServersTestResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntMcpServersTestResultSchema,
  })
  .strict();

// ent/mcp/tools/list - List tools from a specific MCP server
const EntMcpToolsListParamsSchema = z
  .object({
    serverId: NonEmptyStringSchema,
  })
  .strict();

const EntMcpToolsListResultSchema = z
  .object({
    serverId: NonEmptyStringSchema,
    tools: z.array(
      z
        .object({
          name: NonEmptyStringSchema,
          description: z.string().optional(),
          inputSchema: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
    ),
  })
  .strict();

export const EntMcpToolsListRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/mcp/tools/list'),
    params: EntMcpToolsListParamsSchema,
  })
  .strict();

export const EntMcpToolsListResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntMcpToolsListResultSchema,
  })
  .strict();

const EntJobInjectParamsSchema = z
  .object({
    jobId: NonEmptyStringSchema,
    content: z.array(ContentBlockSchema),
    priority: z.enum(['immediate', 'normal', 'deferred']),
  })
  .strict();

export const EntJobInjectNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('ent/job/inject'),
    params: EntJobInjectParamsSchema,
  })
  .strict();

// ent/workspace/info - Get workspace information
const EntWorkspaceInfoParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
  })
  .strict();

const EntWorkspaceInfoResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    projectDir: NonEmptyStringSchema,
    clonePath: NonEmptyStringSchema,
    containerId: NonEmptyStringSchema,
    state: NonEmptyStringSchema,
    containerMountPath: NonEmptyStringSchema.optional(),
    branchName: NonEmptyStringSchema.optional(),
  })
  .strict();

export const EntWorkspaceInfoRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/workspace/info'),
    params: EntWorkspaceInfoParamsSchema,
  })
  .strict();

export const EntWorkspaceInfoResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntWorkspaceInfoResultSchema,
  })
  .strict();

// ent/workspace/create - Create a workspace container
const EntWorkspaceCreateParamsSchema = z
  .object({
    projectDir: NonEmptyStringSchema,
    sessionId: SessionIdSchema,
  })
  .strict();

const EntWorkspaceCreateResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    projectDir: NonEmptyStringSchema,
    clonePath: NonEmptyStringSchema,
    containerId: NonEmptyStringSchema,
    state: NonEmptyStringSchema,
    containerMountPath: NonEmptyStringSchema.optional(),
    branchName: NonEmptyStringSchema.optional(),
  })
  .strict();

export const EntWorkspaceCreateRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/workspace/create'),
    params: EntWorkspaceCreateParamsSchema,
  })
  .strict();

export const EntWorkspaceCreateResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntWorkspaceCreateResultSchema,
  })
  .strict();

const SessionUpdateTextDeltaSchema = z
  .object({
    type: z.literal('text_delta'),
    text: z.string(),
  })
  .strict();

const SessionUpdateThinkingSchema = z
  .object({
    type: z.literal('thinking'),
    text: z.string(),
  })
  .strict();

const SessionUpdateUsageSchema = z
  .object({
    type: z.literal('usage'),
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    thinkingTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();

const SessionUpdateModeChangeSchema = z
  .object({
    type: z.literal('mode_change'),
    mode: z.string(),
    previousMode: z.string(),
  })
  .strict();

const SessionUpdateContextInjectedSchema = z
  .object({
    type: z.literal('context_injected'),
    priority: z.string(),
    messageCount: z.number(),
  })
  .strict();

const SessionUpdatePlanSchema = z
  .object({
    type: z.literal('plan'),
    tasks: z.array(
      z
        .object({
          taskId: NonEmptyStringSchema,
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed']),
          priority: z.number().optional(),
        })
        .strict()
    ),
  })
  .strict();

const SessionUpdateToolUseSchema = z
  .object({
    type: z.literal('tool_use'),
    toolCallId: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    kind: z
      .enum(['read', 'edit', 'delete', 'search', 'execute', 'think', 'fetch', 'other'])
      .optional(),
    input: z.record(z.string(), z.unknown()),
    status: z.enum([
      'pending',
      'awaiting_permission',
      'running',
      'completed',
      'failed',
      'denied',
      'timeout',
      'cancelled',
    ]),
    result: ToolResultSchema.optional(),
  })
  .strict();

const SessionUpdateJobStartedSchema = z
  .object({
    type: z.literal('job_started'),
    jobId: NonEmptyStringSchema,
    parentJobId: NonEmptyStringSchema.optional(),
    jobType: z.enum(['shell', 'subagent']),
    description: z.string().optional(),
  })
  .strict();

const SessionUpdateJobFinishedSchema = z
  .object({
    type: z.literal('job_finished'),
    jobId: NonEmptyStringSchema,
    parentJobId: NonEmptyStringSchema.optional(),
    exitCode: z.number().optional(),
    outcome: z.enum(['completed', 'failed', 'cancelled']),
  })
  .strict();

const SessionUpdateTurnStartSchema = z
  .object({
    type: z.literal('turn_start'),
  })
  .strict();

const SessionUpdateTurnEndSchema = z
  .object({
    type: z.literal('turn_end'),
    stopReason: z.enum(['end_turn', 'max_tokens', 'max_turns', 'cancelled', 'budget_exceeded']),
    content: z.array(ContentBlockSchema),
    usage: UsageInfoSchema,
  })
  .strict();

// MCP Configuration Changed - notifies when MCP servers are added/removed/updated
const SessionUpdateMcpConfigChangedSchema = z
  .object({
    type: z.literal('mcp_config_changed'),
    operation: z.enum(['added', 'removed', 'updated']),
    serverId: z.string(),
    serverName: z.string().optional(),
  })
  .strict();
export type SessionUpdateMcpConfigChanged = z.infer<typeof SessionUpdateMcpConfigChangedSchema>;

// MCP Server Status - notifies of MCP server connection state changes
const SessionUpdateMcpServerStatusSchema = z
  .object({
    type: z.literal('mcp_server_status'),
    serverId: z.string(),
    status: z.enum(['connecting', 'connected', 'disconnected', 'error']),
    error: z.string().optional(),
  })
  .strict();
export type SessionUpdateMcpServerStatus = z.infer<typeof SessionUpdateMcpServerStatusSchema>;

// Session Info - ACP-aligned session_info_update for session metadata
const SessionUpdateSessionInfoSchema = z
  .object({
    type: z.literal('session_info'),
    title: NonEmptyStringSchema.optional(),
    updatedAt: IsoTimestampSchema.optional(),
    _meta: z.record(z.unknown()).optional(),
  })
  .strict();
export type SessionUpdateSessionInfo = z.infer<typeof SessionUpdateSessionInfoSchema>;

// Compaction Start - notifies when context compaction begins
const SessionUpdateCompactionStartSchema = z
  .object({
    type: z.literal('compaction_start'),
    strategy: z.string(),
    targetTokens: z.number().optional(),
  })
  .strict();
export type SessionUpdateCompactionStart = z.infer<typeof SessionUpdateCompactionStartSchema>;

// Compaction Complete - notifies when context compaction finishes
const SessionUpdateCompactionCompleteSchema = z
  .object({
    type: z.literal('compaction_complete'),
    strategy: z.string(),
    messagesCompacted: z.number(),
    tokensReclaimed: z.number().optional(),
  })
  .strict();
export type SessionUpdateCompactionComplete = z.infer<typeof SessionUpdateCompactionCompleteSchema>;

// Context Window - ACP-aligned usage_update for context window status
const SessionUpdateContextWindowSchema = z
  .object({
    type: z.literal('context_window'),
    used: z.number(),
    size: z.number(),
    percentage: z.number().optional(),
  })
  .strict();
export type SessionUpdateContextWindow = z.infer<typeof SessionUpdateContextWindowSchema>;

// Error Notification - notifies of agent errors
const SessionUpdateErrorSchema = z
  .object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    phase: z.enum(['initialization', 'tool_execution', 'generation', 'unknown']).optional(),
    details: z.record(z.unknown()).optional(),
  })
  .strict();
export type SessionUpdateError = z.infer<typeof SessionUpdateErrorSchema>;

const SessionUpdateBaseParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    streamSeq: z.number(),
    turnId: NonEmptyStringSchema.optional(),
    turnSeq: z.number().optional(),
    jobId: NonEmptyStringSchema.optional(),
  })
  .strict();

const SessionUpdateInnerNonJobSchema = z.discriminatedUnion('type', [
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateUsageSchema,
  SessionUpdateModeChangeSchema,
  SessionUpdateContextInjectedSchema,
  SessionUpdatePlanSchema,
  SessionUpdateToolUseSchema,
  SessionUpdateTurnStartSchema,
  SessionUpdateTurnEndSchema,
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
  SessionUpdateSessionInfoSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateContextWindowSchema,
  SessionUpdateErrorSchema,
]);

const SessionUpdateJobUpdateSchema = z
  .object({
    type: z.literal('job_update'),
    jobId: NonEmptyStringSchema,
    parentJobId: NonEmptyStringSchema.optional(),
    jobType: z.enum(['shell', 'subagent']).optional(),
    channel: z.enum(['stdout', 'stderr', 'internal']).optional(),
    update: SessionUpdateInnerNonJobSchema,
  })
  .strict();

const _SessionUpdateInnerSchema = z.discriminatedUnion('type', [
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateUsageSchema,
  SessionUpdateModeChangeSchema,
  SessionUpdateContextInjectedSchema,
  SessionUpdatePlanSchema,
  SessionUpdateToolUseSchema,
  SessionUpdateJobStartedSchema,
  SessionUpdateJobFinishedSchema,
  SessionUpdateJobUpdateSchema,
  SessionUpdateTurnStartSchema,
  SessionUpdateTurnEndSchema,
  SessionUpdateMcpConfigChangedSchema,
  SessionUpdateMcpServerStatusSchema,
  SessionUpdateSessionInfoSchema,
  SessionUpdateCompactionStartSchema,
  SessionUpdateCompactionCompleteSchema,
  SessionUpdateContextWindowSchema,
  SessionUpdateErrorSchema,
]);

const SessionUpdateParamsSchema = z.discriminatedUnion('type', [
  SessionUpdateBaseParamsSchema.merge(SessionUpdateTextDeltaSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateThinkingSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateUsageSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateModeChangeSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateContextInjectedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdatePlanSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateToolUseSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateJobStartedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateJobFinishedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateJobUpdateSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateTurnStartSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateTurnEndSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateMcpConfigChangedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateMcpServerStatusSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateSessionInfoSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateCompactionStartSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateCompactionCompleteSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateContextWindowSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateErrorSchema),
]);

export const SessionUpdateNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('session/update'),
    params: SessionUpdateParamsSchema,
  })
  .strict();

const SessionRequestPermissionParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    turnId: NonEmptyStringSchema,
    turnSeq: z.number(),
    requestedAt: IsoTimestampSchema,
    jobId: NonEmptyStringSchema.optional(),
    toolCallId: NonEmptyStringSchema,
    tool: NonEmptyStringSchema,
    kind: z.string().optional(),
    resource: NonEmptyStringSchema,
    options: z.array(PermissionOptionSchema),
  })
  .strict();

export const SessionRequestPermissionRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/request_permission'),
    params: SessionRequestPermissionParamsSchema,
  })
  .strict();

const SessionRequestPermissionResultSchema = z
  .object({
    decision: NonEmptyStringSchema,
    updatedInput: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const SessionRequestPermissionResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionRequestPermissionResultSchema,
  })
  .strict();

export const EntProtocolRequestSchema = z.union([
  InitializeRequestSchema,
  SessionNewRequestSchema,
  SessionLoadRequestSchema,
  SessionForkRequestSchema,
  SessionListRequestSchema,
  SessionSetModeRequestSchema,
  SessionPromptRequestSchema,
  EntAgentPingRequestSchema,
  EntAgentStatusRequestSchema,
  EntSessionCompactRequestSchema,
  EntSessionConfigureRequestSchema,
  EntSessionRewindRequestSchema,
  EntSessionCheckpointRequestSchema,
  EntSessionEventsRequestSchema,
  EntProvidersListRequestSchema,
  EntConnectionsListRequestSchema,
  EntConnectionsUpsertRequestSchema,
  EntConnectionsDeleteRequestSchema,
  EntConnectionsTestRequestSchema,
  EntConnectionsCredentialsStatusRequestSchema,
  EntConnectionsCredentialsStartRequestSchema,
  EntConnectionsCredentialsSubmitRequestSchema,
  EntConnectionsCredentialsClearRequestSchema,
  EntModelsListRequestSchema,
  EntModelsRefreshRequestSchema,
  EntToolsListRequestSchema,
  EntPersonasListRequestSchema,
  EntMcpServersListRequestSchema,
  EntMcpServersUpsertRequestSchema,
  EntMcpServersDeleteRequestSchema,
  EntMcpServersTestRequestSchema,
  EntMcpToolsListRequestSchema,
  EntJobListRequestSchema,
  EntJobOutputRequestSchema,
  EntJobKillRequestSchema,
  EntWorkspaceInfoRequestSchema,
  EntWorkspaceCreateRequestSchema,
  SessionRequestPermissionRequestSchema,
]);

export const EntProtocolNotificationSchema = z.union([
  CancelRequestNotificationSchema,
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);

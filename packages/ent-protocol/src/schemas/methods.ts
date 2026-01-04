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
    sessionResume: z.boolean().optional(),
    sessionFork: z.boolean().optional(),
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
    fork: z.boolean().optional(),
  })
  .strict();

const SessionLoadResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    forkedFrom: SessionIdSchema.optional(),
    messageCount: z.number(),
    lastActive: IsoTimestampSchema,
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

const SessionListParamsSchema = z
  .object({
    workDir: NonEmptyStringSchema.optional(),
  })
  .strict();

const SessionListResultSchema = z
  .object({
    sessions: z.array(
      z
        .object({
          sessionId: SessionIdSchema,
          created: IsoTimestampSchema,
          lastActive: IsoTimestampSchema,
          messageCount: z.number(),
          workDir: NonEmptyStringSchema,
        })
        .strict()
    ),
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

export const SessionCancelNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('session/cancel'),
    params: EmptyParamsSchema.optional(),
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

const EntSessionConfigureParamsSchema = z
  .object({
    connectionId: z.string().optional(),
    modelId: z.string().optional(),
    maxThinkingTokens: z.number().optional(),
    maxBudgetUsd: z.number().optional(),
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

const SessionUpdateInnerSchema = z.discriminatedUnion('type', [
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
  SessionListRequestSchema,
  SessionSetModeRequestSchema,
  SessionPromptRequestSchema,
  EntAgentPingRequestSchema,
  EntAgentStatusRequestSchema,
  EntSessionConfigureRequestSchema,
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
  EntJobListRequestSchema,
  EntJobOutputRequestSchema,
  EntJobKillRequestSchema,
  SessionRequestPermissionRequestSchema,
]);

export const EntProtocolNotificationSchema = z.union([
  SessionCancelNotificationSchema,
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);

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
  CatalogProviderInfoSchema,
  SandboxConfigSchema,
  SessionConfigOptionSchema,
  RuntimeExecutionBindingSchema,
  ToolInfoSchema,
  ToolResultSchema,
  UsageInfoSchema,
} from './shared';

const EmptyParamsSchema = z.object({}).strict();
const ContainerExecutionTokenEnvNameSchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/);
export const DurableHandoffStatusSchema = z.enum([
  'persisted-new',
  'duplicate-already-handled',
  'duplicate-safe-retry',
  'duplicate-in-progress',
  'duplicate-unsafe-retry',
  'not-persisted',
]);
export type DurableHandoffStatus = z.infer<typeof DurableHandoffStatusSchema>;

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
    source: z.enum(['builtin', 'user']).optional(),
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
        close: z.object({}).optional(),
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
    'ent/promptIdempotency': z.boolean().optional(),
    'ent/providers': z
      .object({
        list: z.boolean(),
        connections: z.boolean(),
        models: z.boolean(),
        catalogRefresh: z.boolean().optional(),
        modelGating: z.boolean().optional(),
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
        maxBudgetUsd: z.number().optional(),
        maxThinkingTokens: z.number().optional(),
        enableFileCheckpointing: z.boolean().optional(),
        sandbox: SandboxConfigSchema.optional(),
      })
      .strict()
      .optional(),
    // Ordered persona search paths (earlier paths win). When omitted, the
    // agent uses its default user-persona directory under laceDir.
    userPersonasPaths: z.array(NonEmptyStringSchema).optional(),
    // Embedder package root. lace resolves relative `command`/`args`
    // of host-placement MCP servers declared in a persona against this base (the
    // server scripts live under the embedder's package, not lace's cwd).
    mcpBaseDir: NonEmptyStringSchema.optional(),
    // Ordered skill directories (earlier paths win on name conflict). When
    // omitted, the agent uses its default discovery (project + user level
    // `.lace/skills` and `.claude/skills`). When provided, these directories
    // are used exclusively — the embedder controls the skill search path.
    skillDirs: z.array(NonEmptyStringSchema).optional(),
    // Named-mount registry consulted when a persona with
    // `runtime.type: 'container'` is materialized. Each persona declares
    // logical mount names; this registry pins the matching host path,
    // container-side path, and readonly flag. Mount names must match
    // ^[a-z][a-z0-9-]*$ . Defaults to {} when omitted.
    containerMounts: z
      .record(
        z.string().regex(/^[a-z][a-z0-9-]*$/),
        z
          .object({
            hostPath: NonEmptyStringSchema,
            containerPath: NonEmptyStringSchema,
            readonly: z.boolean(),
          })
          .strict()
      )
      .optional()
      .default({}),
    containerExecutionIdentity: z
      .object({
        tokenEnvName: ContainerExecutionTokenEnvNameSchema,
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
    cwd: NonEmptyStringSchema,
    mcpServers: z.array(McpServerConfigSchema).optional(),
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
    // When supplied, persona's frontmatter populates session config defaults
    // (model, tools, mcpServers); request-level fields override persona defaults.
    config: z
      .object({
        connectionId: NonEmptyStringSchema.optional(),
        modelId: NonEmptyStringSchema.optional(),
        persona: NonEmptyStringSchema.optional(),
        runtimeBinding: RuntimeExecutionBindingSchema.optional(),
      })
      .strict()
      .optional(),
    // Links this session to the parent session that spawned it (subagent path).
    parent: z
      .object({
        sessionId: SessionIdSchema,
        jobId: NonEmptyStringSchema,
        personaName: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SessionNewResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    created: IsoTimestampSchema,
    configOptions: z.array(SessionConfigOptionSchema).optional(),
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
    cwd: NonEmptyStringSchema,
    mcpServers: z.array(McpServerConfigSchema),
    config: z
      .object({
        runtimeBinding: RuntimeExecutionBindingSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SessionLoadResultSchema = z
  .object({
    sessionId: SessionIdSchema,
    messageCount: z.number(),
    updatedAt: IsoTimestampSchema,
    configOptions: z.array(SessionConfigOptionSchema).optional(),
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

const SessionResumeParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    cwd: NonEmptyStringSchema,
    mcpServers: z.array(McpServerConfigSchema),
    config: z
      .object({
        runtimeBinding: RuntimeExecutionBindingSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SessionResumeResultSchema = z.object({}).strict();

export const SessionResumeRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/resume'),
    params: SessionResumeParamsSchema,
  })
  .strict();

export const SessionResumeResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionResumeResultSchema,
  })
  .strict();

const SessionCloseParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
  })
  .strict();

const SessionCloseResultSchema = z.object({}).strict();

export const SessionCloseRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/close'),
    params: SessionCloseParamsSchema,
  })
  .strict();

export const SessionCloseResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionCloseResultSchema,
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

const SessionListParamsSchema = z
  .object({
    cwd: NonEmptyStringSchema.optional(),
    cursor: NonEmptyStringSchema.optional(),
  })
  .strict();

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

const SessionSetConfigOptionParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
    configId: NonEmptyStringSchema,
    value: NonEmptyStringSchema,
  })
  .strict();

const SessionSetConfigOptionResultSchema = z
  .object({
    configOptions: z.array(SessionConfigOptionSchema),
  })
  .strict();

export const SessionSetConfigOptionRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('session/set_config_option'),
    params: SessionSetConfigOptionParamsSchema,
  })
  .strict();

export const SessionSetConfigOptionResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: SessionSetConfigOptionResultSchema,
  })
  .strict();

const SessionPromptParamsSchema = z
  .object({
    content: z.array(ContentBlockSchema),
    maxTurns: z.number().optional(),
    idempotencyKey: NonEmptyStringSchema.optional(),
    track: NonEmptyStringSchema.optional(),
    outputFormat: z
      .object({
        type: z.literal('json_schema'),
        schema: z.record(z.string(), z.unknown()),
      })
      .strict()
      .optional(),
  })
  .strict();

// Discriminated union mirroring @anthropic-ai/sdk's BetaDiagnostics.cache_miss_reason.
// SDK 0.98.0 exposes each variant as an individual interface — we mirror the
// shape here in Zod so durable turn_end events and session/update streams can
// carry the value through the protocol boundary with the same type-narrowing
// guarantees as on the TS side. Variants with a comparable prefix carry the
// approximate cache_missed_input_tokens count; variants without (`unavailable`,
// `previous_message_not_found`) omit it.
const BetaCacheMissReasonSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('model_changed'),
      cache_missed_input_tokens: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('system_changed'),
      cache_missed_input_tokens: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('tools_changed'),
      cache_missed_input_tokens: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('messages_changed'),
      cache_missed_input_tokens: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal('previous_message_not_found'),
    })
    .strict(),
  z
    .object({
      type: z.literal('unavailable'),
    })
    .strict(),
]);

// Structured detail accompanying a canonical stop reason. Mirrors
// `LaceStopDetails` in @lace/agent/providers/stop-reason. The discriminator
// `type` matches the subset of stop reasons that carry extra context; reasons
// with no extra context (e.g. `end_turn`, `tool_use`) emit `stopDetails: null`.
const LaceStopDetailsSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('refusal'),
      category: z.string().nullable(),
      explanation: z.string().nullable(),
      source: z.enum([
        'anthropic_classifier',
        'openai_chat_content_filter',
        'openai_responses_content_filter',
        'openai_responses_refusal_item',
        'gemini_safety_block',
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal('context_window_exceeded'),
      source: z.enum([
        'anthropic_beta_stop_reason',
        'http_400_prompt_too_long',
        'preflight_token_estimate',
      ]),
      estimatedExcessTokens: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('max_output_tokens'),
      source: z.enum([
        'anthropic_stop_reason',
        'openai_chat_finish_reason',
        'openai_responses_incomplete_details',
      ]),
      requestedMaxTokens: z.number().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('stop_sequence'),
      sequence: z.string(),
      source: z.literal('anthropic_stop_sequence'),
    })
    .strict(),
  z
    .object({
      type: z.literal('pause_turn'),
      source: z.literal('anthropic_stop_reason'),
    })
    .strict(),
  z
    .object({
      type: z.literal('failed'),
      code: z.string(),
      message: z.string(),
      source: z.enum(['openai_responses_failed_status', 'http_error']),
    })
    .strict(),
  z
    .object({
      type: z.literal('cancelled'),
      reason: z.enum(['abort_signal', 'permission_cancelled']),
    })
    .strict(),
]);

const SessionPromptResultSchema = z.union([
  z
    .object({
      turnId: NonEmptyStringSchema,
      stopReason: z.enum([
        'end_turn',
        'stop_sequence',
        'max_output_tokens',
        'context_window_exceeded',
        'refusal',
        'max_turns',
        'cancelled',
        'budget_exceeded',
        'incomplete',
        'permission_cancelled',
        'failed',
        // Fine-grained error stopReasons written by the runner's
        // finally block when the agentic loop threw. The runner rethrows after
        // writing turn_end, so these values do not flow through the RPC response
        // on a real run; they are listed for schema parity with the durable
        // `turn_end` event shape so consumers reading both surfaces accept the
        // same enum.
        'provider_error_overloaded',
        'provider_error_invalid',
        'provider_error_network',
        'provider_error_other',
        'tool_error_throw',
        'tool_error_timeout',
        'internal_error',
      ]),
      stopDetails: LaceStopDetailsSchema.nullable().optional(),
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
      durableHandoffStatus: DurableHandoffStatusSchema.optional(),
    })
    .strict(),
  z
    .object({
      durableHandoffStatus: z.literal('duplicate-already-handled'),
    })
    .strict(),
]);

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

const SessionCancelParamsSchema = z
  .object({
    sessionId: SessionIdSchema,
  })
  .strict();

export const SessionCancelNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('session/cancel'),
    params: SessionCancelParamsSchema,
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
        turnCount: z.number(),
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
    strategy: z.string().min(1).optional(),
    guidance: z.string().min(1).optional(),
  })
  .strict();

const EntSessionCompactResultSchema = z
  .object({
    previousTokens: z.number(),
    currentTokens: z.number(),
    messagesCompacted: z.number(),
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
    maxThinkingTokens: z.number().optional(),
    maxBudgetUsd: z.number().optional(),
    /**
     * Arbitrary environment variables to expose to the agent runtime for this session.
     * Keys/values must be strings to keep the transport simple and avoid leaking objects.
     */
    environment: z.record(z.string(), z.string()).optional(),
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
    idempotencyKey: NonEmptyStringSchema.optional(),
    track: NonEmptyStringSchema.optional(),
  })
  .strict();

export const EntSessionInjectRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/inject'),
    params: EntSessionInjectParamsSchema,
  })
  .strict();

export const EntSessionInjectNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.literal('ent/session/inject'),
    params: EntSessionInjectParamsSchema,
  })
  .strict();

const EntSessionInjectResultSchema = z
  .object({
    durableHandoffStatus: DurableHandoffStatusSchema.optional(),
  })
  .strict();

export const EntSessionInjectResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionInjectResultSchema,
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

const EntSessionTokenUsageResultSchema = z
  .object({
    totalPromptTokens: z.number(),
    totalCompletionTokens: z.number(),
    totalTokens: z.number(),
    contextLimit: z.number(),
    percentUsed: z.number(),
    nearLimit: z.boolean(),
  })
  .strict();

export const EntSessionTokenUsageRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/token_usage'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntSessionTokenUsageResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionTokenUsageResultSchema,
  })
  .strict();

const ContextBreakdownItemDetailSchema = z
  .object({
    name: z.string(),
    tokens: z.number(),
  })
  .strict();

const ContextBreakdownCategoryDetailSchema = z
  .object({
    tokens: z.number(),
    items: z.array(ContextBreakdownItemDetailSchema).optional(),
  })
  .strict();

const ContextBreakdownMessageCategoryDetailSchema = ContextBreakdownCategoryDetailSchema.extend({
  subcategories: z
    .object({
      userMessages: z.object({ tokens: z.number() }).strict(),
      agentMessages: z.object({ tokens: z.number() }).strict(),
      toolCalls: z.object({ tokens: z.number() }).strict(),
      toolResults: z.object({ tokens: z.number() }).strict(),
    })
    .strict(),
}).strict();

const EntSessionContextBreakdownResultSchema = z
  .object({
    timestamp: IsoTimestampSchema,
    modelId: z.string(),
    contextLimit: z.number(),
    totalUsedTokens: z.number(),
    percentUsed: z.number(),
    categories: z
      .object({
        systemPrompt: ContextBreakdownCategoryDetailSchema,
        coreTools: ContextBreakdownCategoryDetailSchema,
        mcpTools: ContextBreakdownCategoryDetailSchema,
        messages: ContextBreakdownMessageCategoryDetailSchema,
        reservedForResponse: ContextBreakdownCategoryDetailSchema,
        freeSpace: ContextBreakdownCategoryDetailSchema,
      })
      .strict(),
  })
  .strict();

export const EntSessionContextBreakdownRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/session/context_breakdown'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntSessionContextBreakdownResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntSessionContextBreakdownResultSchema,
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

const EntProvidersCatalogResultSchema = z
  .object({
    providers: z.array(CatalogProviderInfoSchema),
  })
  .strict();

export const EntProvidersCatalogRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/providers/catalog'),
    params: EmptyParamsSchema.optional(),
  })
  .strict();

export const EntProvidersCatalogResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntProvidersCatalogResultSchema,
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

const EntProvidersRefreshParamsSchema = z
  .object({
    providerId: z.string().optional(),
  })
  .strict()
  .optional();

const EntProvidersRefreshResultSchema = z
  .object({
    ok: z.boolean(),
    refreshedAt: IsoTimestampSchema,
    error: z.string().optional(),
  })
  .strict();

export const EntProvidersRefreshRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/providers/refresh'),
    params: EntProvidersRefreshParamsSchema,
  })
  .strict();

export const EntProvidersRefreshResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntProvidersRefreshResultSchema,
  })
  .strict();

const EntModelsToggleParamsSchema = z
  .object({
    providerId: NonEmptyStringSchema,
    modelIds: z.array(NonEmptyStringSchema).min(1),
  })
  .strict();

const EntModelsToggleResultSchema = z
  .object({
    providerId: NonEmptyStringSchema,
    enabled: z.array(NonEmptyStringSchema),
    disabled: z.array(NonEmptyStringSchema),
  })
  .strict();

export const EntModelsEnableRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/models/enable'),
    params: EntModelsToggleParamsSchema,
  })
  .strict();

export const EntModelsEnableResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntModelsToggleResultSchema,
  })
  .strict();

export const EntModelsDisableRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('ent/models/disable'),
    params: EntModelsToggleParamsSchema,
  })
  .strict();

export const EntModelsDisableResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: EntModelsToggleResultSchema,
  })
  .strict();

const EntJobListResultSchema = z
  .object({
    jobs: z.array(
      z
        .object({
          jobId: NonEmptyStringSchema,
          parentJobId: NonEmptyStringSchema.optional(),
          type: z.enum(['bash', 'delegate']),
          status: z.enum(['running', 'completed', 'failed', 'cancelled']),
          description: z.string().optional(),
          command: z.string().optional(),
          startTime: IsoTimestampSchema,
          parentToolUseId: NonEmptyStringSchema.optional(),
          subagentSessionId: NonEmptyStringSchema.optional(),
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
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    secretEnv: z
      .record(
        z.string(),
        z
          .object({
            namespace: z.enum(['session', 'project', 'host-service']),
            name: NonEmptyStringSchema,
          })
          .strict()
      )
      .optional(),
    placement: z.enum(['toolRuntime', 'host']).optional(),
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

const SessionUpdateThinkingStartSchema = z
  .object({
    type: z.literal('thinking_start'),
    turnId: z.string(),
    turnSeq: z.number(),
  })
  .strict();

const SessionUpdateThinkingDeltaSchema = z
  .object({
    type: z.literal('thinking_delta'),
    text: z.string(),
    turnId: z.string(),
    turnSeq: z.number(),
  })
  .strict();

const SessionUpdateThinkingEndSchema = z
  .object({
    type: z.literal('thinking_end'),
    tokens: z.number(),
    turnId: z.string(),
    turnSeq: z.number(),
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

const ContainerExecutionMetadataSchema = z
  .object({
    personaName: NonEmptyStringSchema,
    parentSessionId: SessionIdSchema,
    jobId: NonEmptyStringSchema,
    containerId: NonEmptyStringSchema.optional(),
    runtimeId: NonEmptyStringSchema.optional(),
    containerSpecName: NonEmptyStringSchema.optional(),
  })
  .strict();

const SessionUpdateJobStartedSchema = z
  .object({
    type: z.literal('job_started'),
    jobId: NonEmptyStringSchema,
    parentJobId: NonEmptyStringSchema.optional(),
    jobType: z.enum(['bash', 'delegate']),
    description: z.string().optional(),
    containerExecutionMetadata: ContainerExecutionMetadataSchema.optional(),
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
    stopReason: z.enum([
      'end_turn',
      'stop_sequence',
      'max_output_tokens',
      'context_window_exceeded',
      'refusal',
      'max_turns',
      'cancelled',
      'budget_exceeded',
      'incomplete',
      'permission_cancelled',
      'failed',
      // Fine-grained error stopReasons written by the runner's
      // finally block when the agentic loop threw. Match the
      // SessionPromptResultSchema enum so durable turn_end events and the
      // session/update notification share a single shape.
      'provider_error_overloaded',
      'provider_error_invalid',
      'provider_error_network',
      'provider_error_other',
      'tool_error_throw',
      'tool_error_timeout',
      'internal_error',
    ]),
    stopDetails: LaceStopDetailsSchema.nullable().optional(),
    cacheMissReason: BetaCacheMissReasonSchema.nullable().optional(),
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

// Session Changed - notifies that the session has been replaced (e.g., from /clear)
const SessionUpdateSessionChangedSchema = z
  .object({
    type: z.literal('session_changed'),
    newSessionId: SessionIdSchema,
    reason: z.enum(['clear', 'fork']).optional(),
  })
  .strict();
export type SessionUpdateSessionChanged = z.infer<typeof SessionUpdateSessionChangedSchema>;

// Pending alarms on graceful subagent exit. The subagent emits this on its
// JSON-RPC peer immediately before shutting down; the parent's per-subagent
// session/update relay composes the <notification kind="subagent-exited">
// wrapper in its own process and appends it as a context_injected event to
// the parent's own events.jsonl under runExclusive. No subagent writes the
// parent's files directly.
const SessionUpdatePendingAlarmsOnExitSchema = z
  .object({
    type: z.literal('pending_alarms_on_exit'),
    alarms: z.array(
      z
        .object({
          id: NonEmptyStringSchema,
          kind: z.enum(['cron', 'once', 'interval']),
          schedule: NonEmptyStringSchema,
          prompt: NonEmptyStringSchema,
          next_fire_at_iso: NonEmptyStringSchema,
          end_at_iso: z.string().nullable(),
          minutes: z.number().int().positive().optional(),
        })
        .strict()
    ),
  })
  .strict();
export type SessionUpdatePendingAlarmsOnExit = z.infer<
  typeof SessionUpdatePendingAlarmsOnExitSchema
>;

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
  SessionUpdateThinkingStartSchema,
  SessionUpdateThinkingDeltaSchema,
  SessionUpdateThinkingEndSchema,
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
  SessionUpdateSessionChangedSchema,
  SessionUpdatePendingAlarmsOnExitSchema,
]);

const SessionUpdateJobUpdateSchema = z
  .object({
    type: z.literal('job_update'),
    jobId: NonEmptyStringSchema,
    parentJobId: NonEmptyStringSchema.optional(),
    jobType: z.enum(['bash', 'delegate']).optional(),
    channel: z.enum(['stdout', 'stderr', 'internal']).optional(),
    update: SessionUpdateInnerNonJobSchema,
  })
  .strict();

const _SessionUpdateInnerSchema = z.discriminatedUnion('type', [
  SessionUpdateTextDeltaSchema,
  SessionUpdateThinkingSchema,
  SessionUpdateThinkingStartSchema,
  SessionUpdateThinkingDeltaSchema,
  SessionUpdateThinkingEndSchema,
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
  SessionUpdateSessionChangedSchema,
  SessionUpdatePendingAlarmsOnExitSchema,
]);

const SessionUpdateParamsSchema = z.discriminatedUnion('type', [
  SessionUpdateBaseParamsSchema.merge(SessionUpdateTextDeltaSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateThinkingSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateThinkingStartSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateThinkingDeltaSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdateThinkingEndSchema),
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
  SessionUpdateBaseParamsSchema.merge(SessionUpdateSessionChangedSchema),
  SessionUpdateBaseParamsSchema.merge(SessionUpdatePendingAlarmsOnExitSchema),
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

// host/spawn/env — outbound (lace → embedder). During delegate-job creation,
// after lace builds the base executionEnv from containerExecutionIdentity, it
// asks the embedder for any additional env vars to merge into the spawn env
// (e.g. per-spawn placeholder tokens injected by the embedder). The embedder may return an
// empty record, or not implement the method at all — lace treats both as
// "no extra env" and proceeds with the base executionEnv. The spawn is never
// blocked by this call.
const HostSpawnEnvParamsSchema = z
  .object({
    jobId: NonEmptyStringSchema,
    persona: NonEmptyStringSchema,
    parentSessionId: SessionIdSchema,
    runtimeId: NonEmptyStringSchema.optional(),
  })
  .strict();

export const HostSpawnEnvRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.literal('host/spawn/env'),
    params: HostSpawnEnvParamsSchema,
  })
  .strict();

const HostSpawnEnvResultSchema = z
  .object({
    env: z.record(z.string(), z.string()),
  })
  .strict();

export const HostSpawnEnvResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: HostSpawnEnvResultSchema,
  })
  .strict();

export type HostSpawnEnvParams = z.infer<typeof HostSpawnEnvParamsSchema>;
export type HostSpawnEnvResult = z.infer<typeof HostSpawnEnvResultSchema>;

export const EntProtocolRequestSchema = z.union([
  InitializeRequestSchema,
  SessionNewRequestSchema,
  SessionLoadRequestSchema,
  SessionResumeRequestSchema,
  SessionCloseRequestSchema,
  SessionForkRequestSchema,
  SessionListRequestSchema,
  SessionSetModeRequestSchema,
  SessionSetConfigOptionRequestSchema,
  SessionPromptRequestSchema,
  EntAgentPingRequestSchema,
  EntAgentStatusRequestSchema,
  EntSessionCompactRequestSchema,
  EntSessionConfigureRequestSchema,
  EntSessionRewindRequestSchema,
  EntSessionCheckpointRequestSchema,
  EntSessionInjectRequestSchema,
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
  EntModelsEnableRequestSchema,
  EntModelsDisableRequestSchema,
  EntProvidersRefreshRequestSchema,
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
  SessionRequestPermissionRequestSchema,
  HostSpawnEnvRequestSchema,
]);

export const EntProtocolNotificationSchema = z.union([
  SessionCancelNotificationSchema,
  EntSessionInjectNotificationSchema,
  EntJobInjectNotificationSchema,
  SessionUpdateNotificationSchema,
]);

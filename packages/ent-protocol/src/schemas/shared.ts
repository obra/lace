import { z } from 'zod';

export const NonEmptyStringSchema = z.string().min(1);
export type NonEmptyString = z.infer<typeof NonEmptyStringSchema>;

export const IsoTimestampSchema = z.string().min(1);
export type IsoTimestamp = z.infer<typeof IsoTimestampSchema>;

export const JsonSchemaSchema: z.ZodType<Record<string, unknown>> = z
  .record(z.string(), z.unknown())
  .refine((v) => typeof v === 'object' && v !== null, { message: 'JsonSchema must be an object' });
export type JsonSchema = z.infer<typeof JsonSchemaSchema>;

export const SandboxConfigSchema = z
  .object({
    enabled: z.boolean(),
    network: z
      .object({
        allowLocalBinding: z.boolean().optional(),
        allowedHosts: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    excludedCommands: z.array(z.string()).optional(),
    allowUnsandboxedCommands: z.boolean().optional(),
  })
  .strict();
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

export const RuntimeSecretReferenceSchema = z
  .object({
    namespace: z.enum(['session', 'project', 'host-service']),
    name: NonEmptyStringSchema,
  })
  .strict();
export type RuntimeSecretReference = z.infer<typeof RuntimeSecretReferenceSchema>;

const HostRuntimeDescriptorSchema = z
  .object({
    type: z.literal('host'),
    cwd: NonEmptyStringSchema,
  })
  .strict();

const BoundedHostRuntimeDescriptorSchema = z
  .object({
    type: z.literal('boundedHost'),
    root: NonEmptyStringSchema,
    cwd: NonEmptyStringSchema,
  })
  .strict();

const RuntimeMountDescriptorSchema = z
  .object({
    hostPath: NonEmptyStringSchema,
    containerPath: NonEmptyStringSchema,
    readonly: z.boolean(),
  })
  .strict();

const RuntimePortDescriptorSchema = z
  .object({
    host: z.number().int(),
    container: z.number().int(),
  })
  .strict();

const ContainerRuntimeDescriptorSchema = z
  .object({
    type: z.literal('container'),
    cwd: NonEmptyStringSchema,
    spec: z
      .object({
        name: NonEmptyStringSchema,
        containerId: NonEmptyStringSchema.optional(),
        requestedImage: NonEmptyStringSchema,
        resolvedImageDigest: NonEmptyStringSchema,
        imagePlatform: NonEmptyStringSchema,
        workingDirectory: NonEmptyStringSchema,
        mounts: z.array(RuntimeMountDescriptorSchema),
        env: z.record(z.string(), z.string()).optional(),
        secretEnv: z.record(z.string(), RuntimeSecretReferenceSchema).optional(),
        ports: z.array(RuntimePortDescriptorSchema).optional(),
        restartPolicy: z.literal('unless-stopped').optional(),
      })
      .strict(),
    // Legacy field: pre-helperless sessions persisted a `helper` descriptor on
    // the binding. The helper is gone and nothing reads this, but the field must
    // be TOLERATED (not strict-rejected) so those persisted sessions still
    // resume. Ignored on parse. Do not reintroduce a producer.
    helper: z.unknown().optional(),
  })
  .strict();

export const RuntimeExecutionBindingSchema = z
  .object({
    schemaVersion: z.literal(1),
    identity: z
      .object({
        runtimeId: NonEmptyStringSchema,
      })
      .strict(),
    toolRuntime: z.discriminatedUnion('type', [
      HostRuntimeDescriptorSchema,
      BoundedHostRuntimeDescriptorSchema,
      ContainerRuntimeDescriptorSchema,
    ]),
  })
  .strict();
export type RuntimeExecutionBinding = z.infer<typeof RuntimeExecutionBindingSchema>;

export const McpServerConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
    secretEnv: z.record(z.string(), RuntimeSecretReferenceSchema).optional(),
    placement: z.enum(['toolRuntime', 'host']).optional(),
    enabled: z.boolean().optional(),
    tools: z.record(z.string(), z.enum(['allow', 'ask', 'deny', 'disable'])).optional(),
  })
  .strict();
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpServerStatusSchema = z
  .object({
    name: NonEmptyStringSchema,
    status: z.enum(['connected', 'connecting', 'disconnected', 'error']),
    error: z.string().optional(),
    tools: z.array(z.string()).optional(),
    lastConnected: IsoTimestampSchema.optional(),
  })
  .strict();
export type McpServerStatus = z.infer<typeof McpServerStatusSchema>;

export const ModelInfoSchema = z
  .object({
    modelId: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    providerId: NonEmptyStringSchema,
    contextWindow: z.number(),
    maxOutput: z.number(),
    supportsThinking: z.boolean().optional(),
    supportsImages: z.boolean().optional(),
    /**
     * Indicates the model is currently disabled via provider-level gating.
     * Absent or false means enabled.
     */
    disabled: z.boolean().optional(),
    /**
     * Explicit enabled/disabled state for UI rendering.
     * When present, MUST be consistent with `disabled`.
     */
    disabledState: z.enum(['enabled', 'disabled']).optional(),
  })
  .strict();
export type ModelInfo = z.infer<typeof ModelInfoSchema>;

export const ToolInfoSchema = z
  .object({
    name: NonEmptyStringSchema,
    description: z.string(),
    kind: z.enum(['read', 'edit', 'delete', 'search', 'execute', 'think', 'fetch', 'other']),
    inputSchema: JsonSchemaSchema,
    requiresPermission: z.boolean().optional(),
  })
  .strict();
export type ToolInfo = z.infer<typeof ToolInfoSchema>;

export const UsageInfoSchema = z
  .object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cacheReadTokens: z.number().optional(),
    cacheWriteTokens: z.number().optional(),
    thinkingTokens: z.number().optional(),
    totalTokens: z.number().optional(),
    costUsd: z.number().optional(),
  })
  .strict();
export type UsageInfo = z.infer<typeof UsageInfoSchema>;

export const ContentBlockSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      data: z.string(),
      mediaType: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_use'),
      toolUseId: NonEmptyStringSchema,
      name: NonEmptyStringSchema,
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('tool_result'),
      toolUseId: NonEmptyStringSchema,
      content: z.string(),
      isError: z.boolean().optional(),
    })
    .strict(),
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const ToolResultContentSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      text: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('json'),
      data: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      data: z.string(),
      mediaType: NonEmptyStringSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('error'),
      message: z.string(),
      code: z.string().optional(),
    })
    .strict(),
]);
export type ToolResultContent = z.infer<typeof ToolResultContentSchema>;

export const ToolResultSchema = z
  .object({
    outcome: z.enum(['completed', 'failed', 'denied', 'timeout', 'cancelled']),
    content: z.array(ToolResultContentSchema),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type ToolResult = z.infer<typeof ToolResultSchema>;

export const PermissionOptionSchema = z
  .object({
    optionId: NonEmptyStringSchema,
    label: z.string(),
  })
  .strict();
export type PermissionOption = z.infer<typeof PermissionOptionSchema>;

export const PermissionRequestSchema = z
  .object({
    requestId: NonEmptyStringSchema,
    toolCallId: NonEmptyStringSchema,
    sessionId: NonEmptyStringSchema,
    turnId: NonEmptyStringSchema,
    turnSeq: z.number(),
    jobId: NonEmptyStringSchema.optional(),
    tool: NonEmptyStringSchema,
    kind: z.string().optional(),
    resource: NonEmptyStringSchema,
    options: z.array(PermissionOptionSchema),
    requestedAt: IsoTimestampSchema,
  })
  .strict();
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const SessionConfigSelectOptionSchema = z
  .object({
    value: NonEmptyStringSchema,
    name: z.string(),
    description: z.string().optional(),
  })
  .strict();
export type SessionConfigSelectOption = z.infer<typeof SessionConfigSelectOptionSchema>;

export const SessionConfigSelectGroupSchema = z
  .object({
    group: NonEmptyStringSchema,
    name: z.string(),
    options: z.array(SessionConfigSelectOptionSchema),
  })
  .strict();
export type SessionConfigSelectGroup = z.infer<typeof SessionConfigSelectGroupSchema>;

export const SessionConfigOptionSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    type: z.literal('select'),
    currentValue: NonEmptyStringSchema,
    options: z.union([
      z.array(SessionConfigSelectOptionSchema),
      z.array(SessionConfigSelectGroupSchema),
    ]),
  })
  .strict();
export type SessionConfigOption = z.infer<typeof SessionConfigOptionSchema>;

export const ProviderInfoSchema = z
  .object({
    providerId: NonEmptyStringSchema,
    displayName: z.string(),
    supportsConnections: z.boolean(),
    supportsCatalogRefresh: z.boolean().optional(),
  })
  .strict();
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ModelConfigSchema = z
  .object({
    enableNewModels: z.boolean(),
    disabledModels: z.array(z.string()),
    disabledProviders: z.array(z.string()),
    filters: z
      .object({
        requiredParameters: z.array(z.string()).optional(),
        maxPromptCostPerMillion: z.number().nonnegative().optional(),
        maxCompletionCostPerMillion: z.number().nonnegative().optional(),
        minContextLength: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const CatalogModelInfoSchema = z
  .object({
    id: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    cost_per_1m_in: z.number().min(0).optional(),
    cost_per_1m_out: z.number().min(0).optional(),
    cost_per_1m_in_cached: z.number().min(0).optional(),
    cost_per_1m_out_cached: z.number().min(0).optional(),
    context_window: z.number().int().positive(),
    default_max_tokens: z.number().int().positive(),
    can_reason: z.boolean().optional(),
    has_reasoning_effort: z.boolean().optional(),
    default_reasoning_effort: z.string().optional(),
    reasoning_effort: z.string().optional(),
    supports_attachments: z.boolean().optional(),
    supported_parameters: z.array(z.string()).optional(),
    // Per-model HTTP headers attached to every provider request for this
    // model. Matches @lace/agent's CatalogModelSchema; lets opt-in beta
    // features (Anthropic's 1M context window) ride with the model entry.
    extra_headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export type CatalogModelInfo = z.infer<typeof CatalogModelInfoSchema>;

export const CatalogProviderInfoSchema = z
  .object({
    name: NonEmptyStringSchema,
    id: NonEmptyStringSchema,
    type: NonEmptyStringSchema,
    api_key: z.string().optional(),
    api_endpoint: z.string().optional(),
    default_large_model_id: NonEmptyStringSchema,
    default_small_model_id: NonEmptyStringSchema,
    models: z.array(CatalogModelInfoSchema),
  })
  .strict();
export type CatalogProviderInfo = z.infer<typeof CatalogProviderInfoSchema>;

export const ConnectionInfoSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    providerId: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    endpoint: z.string().optional(),
    timeout: z.number().optional(),
    retryPolicy: z.string().optional(),
    modelConfig: ModelConfigSchema.optional(),
    hasCredentials: z.boolean().optional(),
    isDefault: z.boolean().optional(),
    createdAt: IsoTimestampSchema.optional(),
    lastUsedAt: IsoTimestampSchema.optional(),
    credentialState: z.enum(['ready', 'missing', 'expired', 'invalid', 'unknown']).optional(),
    accountLabel: z.string().optional(),
  })
  .strict();
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;

export const PersonaInfoSchema = z
  .object({
    name: NonEmptyStringSchema,
    isUserDefined: z.boolean(),
    path: NonEmptyStringSchema,
  })
  .strict();
export type PersonaInfo = z.infer<typeof PersonaInfoSchema>;

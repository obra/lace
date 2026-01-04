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

export const McpServerConfigSchema = z
  .object({
    name: NonEmptyStringSchema,
    command: NonEmptyStringSchema,
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    transport: z.enum(['stdio', 'sse', 'http']).optional(),
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

export const ProviderInfoSchema = z
  .object({
    providerId: NonEmptyStringSchema,
    displayName: z.string(),
    supportsConnections: z.boolean(),
    supportsCatalogRefresh: z.boolean().optional(),
  })
  .strict();
export type ProviderInfo = z.infer<typeof ProviderInfoSchema>;

export const ConnectionInfoSchema = z
  .object({
    connectionId: NonEmptyStringSchema,
    providerId: NonEmptyStringSchema,
    name: NonEmptyStringSchema,
    isDefault: z.boolean().optional(),
    createdAt: IsoTimestampSchema.optional(),
    lastUsedAt: IsoTimestampSchema.optional(),
    credentialState: z.enum(['ready', 'missing', 'expired', 'invalid', 'unknown']).optional(),
    accountLabel: z.string().optional(),
  })
  .strict();
export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;

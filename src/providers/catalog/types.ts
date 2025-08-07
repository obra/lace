// ABOUTME: Types and schemas for provider catalogs and instances
// ABOUTME: Defines Catwalk catalog format and user instance configuration

import { z } from 'zod';

// Catwalk catalog model schema
export const CatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  cost_per_1m_in: z.number().min(0),
  cost_per_1m_out: z.number().min(0),
  cost_per_1m_in_cached: z.number().min(0).optional(),
  cost_per_1m_out_cached: z.number().min(0).optional(),
  context_window: z.number().int().positive(),
  default_max_tokens: z.number().int().positive(),
  can_reason: z.boolean().optional(),
  has_reasoning_effort: z.boolean().optional(),
  default_reasoning_effort: z.string().optional(),
  reasoning_effort: z.string().optional(),
  supports_attachments: z.boolean().optional(),
});

// Catwalk catalog provider schema
export const CatalogProviderSchema = z.object({
  name: z.string().min(1),
  id: z.string().min(1),
  type: z.string().min(1),
  api_key: z.string().optional(),
  api_endpoint: z.string().optional(),
  default_large_model_id: z.string().min(1),
  default_small_model_id: z.string().min(1),
  models: z.array(CatalogModelSchema),
});

// User provider instance schema (connection config only)
export const ProviderInstanceSchema = z.object({
  displayName: z.string().min(1),
  catalogProviderId: z.string().min(1),
  endpoint: z.string().url().optional(),
  timeout: z.number().int().positive().optional(),
  retryPolicy: z.string().optional(),
});

// User instances configuration file
export const ProviderInstancesConfigSchema = z.object({
  version: z.literal('1.0'),
  instances: z.record(ProviderInstanceSchema),
});

// Credential schema (unchanged)
export const CredentialSchema = z.object({
  apiKey: z.string().min(1),
  additionalAuth: z.record(z.unknown()).optional(),
});

export type CatalogModel = z.infer<typeof CatalogModelSchema>;
export type CatalogProvider = z.infer<typeof CatalogProviderSchema>;
export type ProviderInstance = z.infer<typeof ProviderInstanceSchema>;
export type ProviderInstancesConfig = z.infer<typeof ProviderInstancesConfigSchema>;
export type Credential = z.infer<typeof CredentialSchema>;

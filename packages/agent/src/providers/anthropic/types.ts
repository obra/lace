// ABOUTME: Anthropic API response types and schemas
// ABOUTME: Defines Zod schemas for Anthropic's /v1/models endpoint responses

import { z } from 'zod';

export const AnthropicModelSchema = z.object({
  id: z.string(),
  type: z.literal('model'),
  display_name: z.string(),
  created_at: z.string(),
});

export const AnthropicModelsResponseSchema = z.object({
  data: z.array(AnthropicModelSchema),
  has_more: z.boolean(),
  first_id: z.string().nullable(),
  last_id: z.string().nullable(),
});

export type AnthropicModel = z.infer<typeof AnthropicModelSchema>;
export type AnthropicModelsResponse = z.infer<typeof AnthropicModelsResponseSchema>;

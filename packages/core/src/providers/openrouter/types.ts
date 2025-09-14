// ABOUTME: OpenRouter API response types and schemas
// ABOUTME: Defines Zod schemas for OpenRouter's /api/v1/models endpoint responses

import { z } from 'zod';

export const OpenRouterModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  context_length: z.number(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string(),
    request: z.string().optional(),
    image: z.string().optional(),
  }),
  supported_parameters: z.array(z.string()).optional(),
  architecture: z
    .object({
      modality: z.string(),
      tokenizer: z.string().optional(),
      instruct_type: z.string().nullable().optional(),
    })
    .optional(),
  top_provider: z
    .object({
      context_length: z.number().nullable().optional(),
      max_completion_tokens: z.number().nullable().optional(),
      is_moderated: z.boolean().optional(),
    })
    .optional(),
  per_request_limits: z.any().nullable().optional(),
});

export const OpenRouterResponseSchema = z.object({
  data: z.array(OpenRouterModelSchema),
});

export type OpenRouterModel = z.infer<typeof OpenRouterModelSchema>;
export type OpenRouterResponse = z.infer<typeof OpenRouterResponseSchema>;

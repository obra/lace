// ABOUTME: OpenAI API response types and schemas
// ABOUTME: Defines Zod schemas for OpenAI's /v1/models endpoint responses

import { z } from 'zod';

export const OpenAIModelSchema = z.object({
  id: z.string(),
  object: z.literal('model'),
  created: z.number(),
  owned_by: z.string(),
});

export const OpenAIResponseSchema = z.object({
  object: z.literal('list'),
  data: z.array(OpenAIModelSchema),
});

export type OpenAIModel = z.infer<typeof OpenAIModelSchema>;
export type OpenAIResponse = z.infer<typeof OpenAIResponseSchema>;

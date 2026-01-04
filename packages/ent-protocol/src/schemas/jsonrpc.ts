import { z } from 'zod';

export const JsonRpcVersionSchema = z.literal('2.0');

export const JsonRpcIdSchema = z.union([z.string(), z.number(), z.null()]);

export const JsonRpcErrorObjectSchema = z
  .object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  })
  .strict();

export const JsonRpcRequestSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export const JsonRpcNotificationSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    method: z.string().min(1),
    params: z.unknown().optional(),
  })
  .strict();

export const JsonRpcSuccessResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    result: z.unknown(),
  })
  .strict();

export const JsonRpcErrorResponseSchema = z
  .object({
    jsonrpc: JsonRpcVersionSchema,
    id: JsonRpcIdSchema,
    error: JsonRpcErrorObjectSchema,
  })
  .strict();

export const JsonRpcResponseSchema = z.union([
  JsonRpcSuccessResponseSchema,
  JsonRpcErrorResponseSchema,
]);

export const JsonRpcMessageSchema = z.union([
  JsonRpcRequestSchema,
  JsonRpcNotificationSchema,
  JsonRpcResponseSchema,
]);

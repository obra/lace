import { z } from 'zod';

export type SessionId = string & { readonly __brand: 'SessionId' };

export const SessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value), {
    message: 'sessionId must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/',
  })
  .refine((value) => !value.includes('..'), {
    message: 'sessionId must not contain ".."',
  })
  .refine((value) => !value.endsWith('.'), {
    message: 'sessionId must not end with "."',
  })
  .transform((value) => value as SessionId);

export function isSessionId(value: string): value is SessionId {
  return SessionIdSchema.safeParse(value).success;
}

export function asSessionId(value: string): SessionId {
  SessionIdSchema.parse(value);
  return value as SessionId;
}

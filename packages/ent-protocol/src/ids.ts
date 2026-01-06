import { z } from 'zod';

export type SessionId = string & { readonly __brand: 'SessionId' };

export const SessionIdSchema = z
  .string()
  .refine(
    (value) => /^sess_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),
    {
      message: 'sessionId must be sess_<uuid> format',
    }
  )
  .transform((value) => value as SessionId);

export function isSessionId(value: string): value is SessionId {
  return SessionIdSchema.safeParse(value).success;
}

export function asSessionId(value: string): SessionId {
  SessionIdSchema.parse(value);
  return value as SessionId;
}

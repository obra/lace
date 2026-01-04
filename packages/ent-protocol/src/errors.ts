export const EntErrorCodes = {
  ProviderError: 7,
  JobNotFound: 8,
  NotInitialized: 9,
  AlreadyInitialized: 10,
  BudgetExceeded: 11,
  CheckpointNotFound: 12,
  StructuredOutputInvalid: 13,
  ConnectionNotFound: 14,
} as const;

export type EntErrorCode = (typeof EntErrorCodes)[keyof typeof EntErrorCodes];

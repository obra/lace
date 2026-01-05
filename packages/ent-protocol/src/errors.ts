export const AcpErrorCodes = {
  SessionNotFound: 1,
  SessionBusy: 2,
  PermissionDenied: 3,
  ToolNotFound: 4,
  MaxTurnsExceeded: 5,
  Cancelled: 6,
} as const;

export type AcpErrorCode = (typeof AcpErrorCodes)[keyof typeof AcpErrorCodes];

export const EntErrorCodes = {
  ProviderError: 7,
  JobNotFound: 8,
  NotInitialized: 9,
  AlreadyInitialized: 10,
  BudgetExceeded: 11,
  CheckpointNotFound: 12,
  StructuredOutputInvalid: 13,
  ConnectionNotFound: 14,
  McpServerNotFound: 15,
} as const;

export type EntErrorCode = (typeof EntErrorCodes)[keyof typeof EntErrorCodes];

export type ProtocolErrorCode = AcpErrorCode | EntErrorCode;

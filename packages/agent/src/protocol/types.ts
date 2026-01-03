export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  $ref?: string;
};

export type ToolInfo = {
  name: string;
  description: string;
  kind: 'read' | 'edit' | 'delete' | 'search' | 'execute' | 'think' | 'fetch' | 'other';
  inputSchema: JsonSchema;
  requiresPermission?: boolean;
};

export type ToolResultContent =
  | { type: 'text'; text: string }
  | { type: 'json'; data: unknown }
  | { type: 'image'; data: string; mediaType: string }
  | { type: 'error'; message: string; code?: string };

export type ToolResult = {
  outcome: 'completed' | 'failed' | 'denied' | 'timeout' | 'cancelled';
  content: ToolResultContent[];
  meta?: Record<string, unknown>;
};

export type SessionUpdate =
  | { type: 'text_delta'; text: string }
  | {
      type: 'tool_use';
      toolCallId: string;
      name: string;
      kind?: ToolInfo['kind'];
      input: Record<string, unknown>;
      status:
        | 'pending'
        | 'awaiting_permission'
        | 'running'
        | 'completed'
        | 'failed'
        | 'denied'
        | 'timeout'
        | 'cancelled';
      result?: ToolResult;
    };

export type PermissionRequest = {
  requestId: string;
  toolCallId: string;
  sessionId: string;
  turnId: string;
  turnSeq: number;
  jobId?: string;
  tool: string;
  kind?: string;
  resource: string;
  options: Array<{ optionId: string; label: string }>;
  requestedAt: string;
};

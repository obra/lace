import { z } from 'zod';
import {
  SessionRequestPermissionRequestSchema,
  SessionUpdateNotificationSchema,
} from '@lace/ent-protocol';

export type SupervisorSessionUpdate = z.infer<typeof SessionUpdateNotificationSchema>['params'];
export type SupervisorPermissionRequest = z.infer<
  typeof SessionRequestPermissionRequestSchema
>['params'];

export type SupervisorServerEvent =
  | {
      type: 'session_update';
      workspaceSessionId: string;
      projectId?: string;
      update: SupervisorSessionUpdate;
    }
  | {
      type: 'permission_request';
      workspaceSessionId: string;
      projectId?: string;
      request: SupervisorPermissionRequest;
      toolCall?: { name: string; arguments: Record<string, unknown> };
      requestedAt: string;
    };

export type PendingPermission = {
  workspaceSessionId: string;
  agentSessionId: string;
  toolCallId: string;
  toolCall?: { name: string; arguments: Record<string, unknown> };
  request: SupervisorPermissionRequest;
  requestedAt: string;
};

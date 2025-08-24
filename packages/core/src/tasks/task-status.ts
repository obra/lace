// ABOUTME: Centralized task status definitions and utilities
// ABOUTME: Single source of truth for all task status-related functionality

import { z } from 'zod';

export const TASK_STATUSES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  BLOCKED: 'blocked',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
} as const;

export type TaskStatus = (typeof TASK_STATUSES)[keyof typeof TASK_STATUSES];

export const TASK_STATUS_CONFIG = {
  [TASK_STATUSES.PENDING]: {
    label: 'Pending',
    icon: '○',
    emoji: '📋',
    color: 'info',
    // Web UI specific
    badgeColor: 'badge-info',
    bgColor: 'bg-info',
    tailwindColor: 'info',
    columnColor: 'bg-info/10 border-info/20',
    order: 0,
    description: 'Task is awaiting action',
  },
  [TASK_STATUSES.IN_PROGRESS]: {
    label: 'In Progress',
    icon: '◐',
    emoji: '⚡',
    color: 'warning',
    // Web UI specific
    badgeColor: 'badge-warning',
    bgColor: 'bg-warning',
    tailwindColor: 'warning',
    columnColor: 'bg-warning/10 border-warning/20',
    order: 1,
    description: 'Task is actively being worked on',
  },
  [TASK_STATUSES.BLOCKED]: {
    label: 'Blocked',
    icon: '⊗',
    emoji: '🚫',
    color: 'error',
    // Web UI specific
    badgeColor: 'badge-error',
    bgColor: 'bg-secondary',
    tailwindColor: 'secondary',
    columnColor: 'bg-secondary/10 border-secondary/20',
    order: 2,
    description: 'Task is temporarily blocked',
  },
  [TASK_STATUSES.COMPLETED]: {
    label: 'Completed',
    icon: '✓',
    emoji: '✅',
    color: 'success',
    // Web UI specific
    badgeColor: 'badge-success',
    bgColor: 'bg-success',
    tailwindColor: 'success',
    columnColor: 'bg-success/10 border-success/20',
    order: 3,
    description: 'Task has been completed',
  },
  [TASK_STATUSES.ARCHIVED]: {
    label: 'Archived',
    icon: '📁',
    emoji: '📁',
    color: 'neutral',
    // Web UI specific
    badgeColor: 'badge-neutral',
    bgColor: 'bg-base-300',
    tailwindColor: 'base-300',
    columnColor: 'bg-base-300/10 border-base-300/20',
    order: 4,
    description: 'Task archived (will not be completed)',
  },
} as const;

// Utility functions
export const getStatusConfig = (status: TaskStatus) => TASK_STATUS_CONFIG[status];
export const getStatusIcon = (status: TaskStatus) => TASK_STATUS_CONFIG[status].icon;
export const getStatusLabel = (status: TaskStatus) => TASK_STATUS_CONFIG[status].label;
export const getStatusColor = (status: TaskStatus) => TASK_STATUS_CONFIG[status].color;
export const getStatusOrder = (status: TaskStatus) => TASK_STATUS_CONFIG[status].order;

// Web UI helpers
export const getStatusBadgeColor = (status: TaskStatus) => TASK_STATUS_CONFIG[status].badgeColor;
export const getStatusBgColor = (status: TaskStatus) => TASK_STATUS_CONFIG[status].bgColor;
export const getStatusColumnColor = (status: TaskStatus) => TASK_STATUS_CONFIG[status].columnColor;

// Arrays for validation/iteration
export const TASK_STATUS_VALUES = Object.values(TASK_STATUSES);
export const TASK_STATUS_ORDERED = TASK_STATUS_VALUES.sort(
  (a, b) => getStatusOrder(a) - getStatusOrder(b)
);

// Zod schema helper - use centralized values for true single source of truth
export const TaskStatusSchema = z.enum(TASK_STATUS_VALUES as [TaskStatus, ...TaskStatus[]]);

// Database constraint helper
export const getTaskStatusDBConstraint = () =>
  `status IN (${TASK_STATUS_VALUES.map((s) => `'${s}'`).join(', ')})`;

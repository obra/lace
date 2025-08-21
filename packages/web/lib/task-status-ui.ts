// ABOUTME: Web UI specific task status utilities
// ABOUTME: Provides React-friendly status helpers and option arrays

import {
  TASK_STATUS_CONFIG,
  TASK_STATUS_ORDERED,
  type TaskStatus,
  getStatusConfig,
} from '@lace/core/tasks/task-status';

// For select dropdowns
export const getStatusOptions = () =>
  TASK_STATUS_ORDERED.map((status) => {
    const config = TASK_STATUS_CONFIG[status];
    return {
      value: status,
      label: `${config.emoji} ${config.label}`,
      color: config.badgeColor,
    };
  });

// For kanban columns
export const getKanbanColumns = () =>
  TASK_STATUS_ORDERED.map((status) => {
    const config = TASK_STATUS_CONFIG[status];
    return {
      id: status,
      title: config.label,
      status,
      color: config.columnColor,
    };
  });

// Individual utility functions for easier imports
export const getStatusBadgeColor = (status: TaskStatus) => {
  return getStatusConfig(status).badgeColor;
};

export const getStatusBgColor = (status: TaskStatus) => {
  return getStatusConfig(status).bgColor;
};

export const getStatusColumnColor = (status: TaskStatus) => {
  return getStatusConfig(status).columnColor;
};

export const getStatusEmoji = (status: TaskStatus) => {
  return getStatusConfig(status).emoji;
};

export const getStatusLabel = (status: TaskStatus) => {
  return getStatusConfig(status).label;
};

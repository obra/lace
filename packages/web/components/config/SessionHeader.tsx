// ABOUTME: Header component for session configuration panel showing project info
// ABOUTME: Displays project name, description, and icon with consistent styling

'use client';

import React, { memo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder } from '@/lib/fontawesome';
import type { ProjectInfo } from '@/types/core';

interface SessionHeaderProps {
  project: ProjectInfo;
}

export const SessionHeader = memo(function SessionHeader({ project }: SessionHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        <FontAwesomeIcon icon={faFolder} className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-xl font-semibold text-base-content">{project.name}</h2>
          <p className="text-sm text-base-content/60">{project.description}</p>
        </div>
      </div>
    </div>
  );
});

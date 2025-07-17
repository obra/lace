// ABOUTME: Project instructions editor component for CLAUDE.md file
// ABOUTME: Handles loading/saving project-specific instructions that guide development

'use client';

import React, { useState } from 'react';
import { InstructionsEditor } from './InstructionsEditor';
import { ExclamationTriangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';

interface ProjectInstructionsEditorProps {
  className?: string;
}

interface ProjectInstructionAPI {
  load: () => Promise<string>;
  save: (content: string) => Promise<void>;
}

export function ProjectInstructionsEditor({ className }: ProjectInstructionsEditorProps) {
  const [api] = useState<ProjectInstructionAPI>(() => ({
    load: async () => {
      const response = await fetch('/api/project-instructions', {
        method: 'GET',
      });
      if (!response.ok) {
        throw new Error(`Failed to load project instructions: ${response.statusText}`);
      }
      const data = await response.json();
      return data.content || '';
    },
    
    save: async (content: string) => {
      const response = await fetch('/api/project-instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save project instructions: ${response.statusText}`);
      }
    },
  }));

  return (
    <div className={`project-instructions-editor ${className}`}>
      <InstructionsEditor
        title="Project Instructions Editor (CLAUDE.md)"
        placeholder="Enter project-specific instructions and guidelines..."
        onLoad={api.load}
        onSave={api.save}
        autoSave={true}
        autoSaveDelay={5000}
        className="h-full"
      />
      
      <div className="mt-4 space-y-4">
        <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg">
          <div className="flex items-start gap-3">
            <ExclamationTriangleIcon className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-warning mb-1">Important</h3>
              <p className="text-sm text-base-content/70">
                This file contains project-specific instructions that guide how Claude Code works with your codebase. 
                Changes affect all future conversations and should be made carefully.
              </p>
            </div>
          </div>
        </div>
        
        <div className="p-4 bg-info/10 border border-info/20 rounded-lg">
          <div className="flex items-start gap-3">
            <InformationCircleIcon className="w-5 h-5 text-info mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold text-info mb-1">About CLAUDE.md</h3>
              <p className="text-sm text-base-content/70 mb-2">
                This file is automatically read by Claude Code and contains:
              </p>
              <ul className="text-sm text-base-content/70 space-y-1">
                <li>• Project architecture and design patterns</li>
                <li>• Development standards and best practices</li>
                <li>• Testing strategies and requirements</li>
                <li>• Code style and formatting guidelines</li>
                <li>• Technology stack and dependencies</li>
              </ul>
              <p className="text-sm text-base-content/70 mt-2">
                Location: <code className="bg-base-300 px-1 py-0.5 rounded text-xs">
                  /project-root/CLAUDE.md
                </code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
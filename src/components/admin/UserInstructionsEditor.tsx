// ABOUTME: User instructions editor component that integrates with Lace's instruction system
// ABOUTME: Handles loading/saving user instructions from ~/.lace/instructions.md

'use client';

import React, { useState, useCallback } from 'react';
import { InstructionsEditor } from './InstructionsEditor';
import { getUserInstructionsFilePath } from '~/config/paths';

interface UserInstructionsEditorProps {
  className?: string;
}

interface InstructionAPI {
  load: () => Promise<string>;
  save: (content: string) => Promise<void>;
}

export function UserInstructionsEditor({ className }: UserInstructionsEditorProps) {
  const [api] = useState<InstructionAPI>(() => ({
    load: async () => {
      const response = await fetch('/api/instructions', {
        method: 'GET',
      });
      if (!response.ok) {
        throw new Error(`Failed to load instructions: ${response.statusText}`);
      }
      const data = await response.json();
      return data.content || '';
    },
    
    save: async (content: string) => {
      const response = await fetch('/api/instructions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });
      
      if (!response.ok) {
        throw new Error(`Failed to save instructions: ${response.statusText}`);
      }
    },
  }));

  return (
    <div className={`user-instructions-editor ${className}`}>
      <InstructionsEditor
        title="User Instructions Editor"
        placeholder="Enter your custom instructions here... These instructions will be included in every conversation."
        onLoad={api.load}
        onSave={api.save}
        autoSave={true}
        autoSaveDelay={3000}
        className="h-full"
      />
      
      <div className="mt-4 p-4 bg-info/10 border border-info/20 rounded-lg">
        <h3 className="font-semibold text-info mb-2">About User Instructions</h3>
        <p className="text-sm text-base-content/70 mb-2">
          User instructions are stored in <code className="bg-base-300 px-1 py-0.5 rounded text-xs">
            {getUserInstructionsFilePath()}
          </code> and are automatically included in every conversation.
        </p>
        <p className="text-sm text-base-content/70">
          These instructions help Claude understand your preferences, coding style, and project-specific requirements.
        </p>
      </div>
    </div>
  );
}
// ABOUTME: Admin page for managing user and project instructions
// ABOUTME: Provides tabbed interface for editing both user and project instructions

import { Metadata } from 'next';
import { InstructionsManager } from '~/components/admin/InstructionsManager';

export const metadata: Metadata = {
  title: 'Instructions Editor - Lace Admin',
  description: 'Edit user and project instructions for Claude Code',
};

export default function InstructionsPage() {
  return (
    <div className="min-h-screen bg-base-200">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">Instructions Management</h1>
            <p className="text-base-content/70">
              Manage user preferences and project-specific instructions for Claude Code
            </p>
          </div>
          
          <InstructionsManager />
        </div>
      </div>
    </div>
  );
}
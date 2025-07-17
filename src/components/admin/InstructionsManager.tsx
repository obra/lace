// ABOUTME: Main instructions manager component with tabbed interface
// ABOUTME: Provides access to both user and project instructions editing

'use client';

import React, { useState } from 'react';
import { 
  UserIcon, 
  DocumentTextIcon, 
  CogIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline';
import { UserInstructionsEditor } from './UserInstructionsEditor';
import { ProjectInstructionsEditor } from './ProjectInstructionsEditor';

type TabType = 'user' | 'project' | 'help';

interface TabConfig {
  id: TabType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}

const TABS: TabConfig[] = [
  {
    id: 'user',
    label: 'User Instructions',
    icon: UserIcon,
    description: 'Personal preferences and custom instructions for Claude Code',
  },
  {
    id: 'project',
    label: 'Project Instructions',
    icon: DocumentTextIcon,
    description: 'Project-specific guidelines and development standards (CLAUDE.md)',
  },
  {
    id: 'help',
    label: 'Help & Documentation',
    icon: InformationCircleIcon,
    description: 'Learn about instructions and how they work',
  },
];

export function InstructionsManager() {
  const [activeTab, setActiveTab] = useState<TabType>('user');

  const renderTabContent = () => {
    switch (activeTab) {
      case 'user':
        return <UserInstructionsEditor className="h-full" />;
      case 'project':
        return <ProjectInstructionsEditor className="h-full" />;
      case 'help':
        return <HelpContent />;
      default:
        return null;
    }
  };

  return (
    <div className="bg-base-100 rounded-lg shadow-lg overflow-hidden">
      {/* Tab Navigation */}
      <div className="border-b border-base-300">
        <div className="flex">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 px-6 py-4 text-left border-b-2 transition-all duration-200 ${
                  activeTab === tab.id
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-base-content/70 hover:text-base-content hover:bg-base-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5" />
                  <div>
                    <div className="font-medium">{tab.label}</div>
                    <div className="text-sm text-base-content/60">{tab.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="h-[calc(100vh-300px)]">
        {renderTabContent()}
      </div>
    </div>
  );
}

function HelpContent() {
  return (
    <div className="p-8 h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-2xl font-bold mb-4">Instructions Guide</h2>
          <p className="text-base-content/70 mb-6">
            Learn how to effectively use instructions to customize Claude Code for your needs.
          </p>
        </div>

        <div className="space-y-6">
          <section>
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-primary" />
              User Instructions
            </h3>
            <div className="bg-base-200 rounded-lg p-4 space-y-3">
              <p className="text-sm text-base-content/70">
                User instructions are personal preferences that apply to all your conversations with Claude Code.
              </p>
              <div className="space-y-2">
                <h4 className="font-medium">Common uses:</h4>
                <ul className="text-sm text-base-content/70 space-y-1 ml-4">
                  <li>• Preferred coding style and formatting</li>
                  <li>• Language and framework preferences</li>
                  <li>• Testing methodology preferences</li>
                  <li>• Communication style preferences</li>
                </ul>
              </div>
              <div className="bg-base-300 rounded p-3">
                <h4 className="font-medium text-sm mb-2">Example:</h4>
                <code className="text-xs text-base-content/70">
                  Always use TypeScript strict mode. Prefer functional programming patterns.
                  Write comprehensive tests for all new features. Use descriptive variable names.
                </code>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <DocumentTextIcon className="w-5 h-5 text-primary" />
              Project Instructions (CLAUDE.md)
            </h3>
            <div className="bg-base-200 rounded-lg p-4 space-y-3">
              <p className="text-sm text-base-content/70">
                Project instructions are specific to your current project and help Claude understand your codebase.
              </p>
              <div className="space-y-2">
                <h4 className="font-medium">Should include:</h4>
                <ul className="text-sm text-base-content/70 space-y-1 ml-4">
                  <li>• Project architecture and design patterns</li>
                  <li>• Technology stack and dependencies</li>
                  <li>• Development workflow and standards</li>
                  <li>• Testing strategies and requirements</li>
                  <li>• Code organization and structure</li>
                </ul>
              </div>
              <div className="bg-base-300 rounded p-3">
                <h4 className="font-medium text-sm mb-2">Example sections:</h4>
                <code className="text-xs text-base-content/70">
                  ## Architecture<br/>
                  Event-sourcing with TypeScript and Node.js<br/><br/>
                  ## Testing<br/>
                  Use Vitest for unit tests, test-first development<br/><br/>
                  ## Code Style<br/>
                  ESLint strict mode, no 'any' types allowed
                </code>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-3 flex items-center gap-2">
              <CogIcon className="w-5 h-5 text-primary" />
              Best Practices
            </h3>
            <div className="bg-base-200 rounded-lg p-4 space-y-3">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium text-green-600 mb-2">Do</h4>
                  <ul className="text-sm text-base-content/70 space-y-1">
                    <li>• Be specific and concrete</li>
                    <li>• Include examples when helpful</li>
                    <li>• Update as your project evolves</li>
                    <li>• Use clear, actionable language</li>
                    <li>• Organize with headings and sections</li>
                  </ul>
                </div>
                <div>
                  <h4 className="font-medium text-red-600 mb-2">Don't</h4>
                  <ul className="text-sm text-base-content/70 space-y-1">
                    <li>• Be overly verbose or vague</li>
                    <li>• Include outdated information</li>
                    <li>• Contradict existing code patterns</li>
                    <li>• Duplicate standard best practices</li>
                    <li>• Use ambiguous requirements</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-semibold mb-3">File Locations</h3>
            <div className="bg-base-200 rounded-lg p-4 space-y-3">
              <div className="grid gap-3">
                <div>
                  <h4 className="font-medium">User Instructions</h4>
                  <code className="text-sm text-base-content/70 bg-base-300 px-2 py-1 rounded">
                    ~/.lace/instructions.md
                  </code>
                </div>
                <div>
                  <h4 className="font-medium">Project Instructions</h4>
                  <code className="text-sm text-base-content/70 bg-base-300 px-2 py-1 rounded">
                    /project-root/CLAUDE.md
                  </code>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
'use client';

import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '@heroicons/react/24/outline';

interface DesignSection {
  id: string;
  title: string;
  status: 'implemented' | 'partial' | 'planned';
  priority: 'high' | 'medium' | 'low';
  description: string;
  backendIntegration?: string[];
}

const designSections: DesignSection[] = [
  {
    id: 'responsive-layout',
    title: 'Mobile-First Responsive Layout',
    status: 'implemented',
    priority: 'high',
    description: 'Desktop sidebar, mobile overlay navigation, touch-optimized interactions',
    backendIntegration: ['User preferences storage', 'Theme persistence']
  },
  {
    id: 'timeline-view',
    title: 'Basic Timeline View',
    status: 'implemented', 
    priority: 'high',
    description: 'Messages display, typing indicators, basic timeline entries',
    backendIntegration: ['Event sourcing', 'Timeline reconstruction', 'Message persistence']
  },
  {
    id: 'theme-system',
    title: 'Theme Management',
    status: 'implemented',
    priority: 'medium',
    description: 'DaisyUI themes, local storage, theme switching',
    backendIntegration: ['User preferences API']
  },
  {
    id: 'carousel-component',
    title: 'Carousel Timeline Entries',
    status: 'planned',
    priority: 'high',
    description: 'Horizontal scrollable carousels for code changes, file lists, rich content',
    backendIntegration: ['Structured timeline data', 'File change detection', 'Code analysis results']
  },
  {
    id: 'integration-entries',
    title: 'External Integration Timeline',
    status: 'planned',
    priority: 'high', 
    description: 'Google Drive, Sheets, Slack integration timeline entries with branded UI',
    backendIntegration: ['OAuth integration', 'External API connectors', 'Integration event tracking']
  },
  {
    id: 'voice-recognition',
    title: 'Voice Input UI',
    status: 'partial',
    priority: 'medium',
    description: 'Voice recognition with waveform visualization, listening states',
    backendIntegration: ['Speech-to-text processing', 'Audio stream handling']
  },
  {
    id: 'modals-system',
    title: 'Modal Management',
    status: 'planned',
    priority: 'medium',
    description: 'Task board, file manager, command palette, settings modals',
    backendIntegration: ['Task management API', 'File system access', 'Command registry']
  },
  {
    id: 'advanced-animations',
    title: 'Micro-interactions & Animations',
    status: 'planned',
    priority: 'low',
    description: 'Smooth transitions, hover effects, loading states',
    backendIntegration: ['Real-time status updates', 'Progress tracking']
  }
];

export default function DesignSystemPage() {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const toggleSection = (id: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedSections(newExpanded);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'implemented': return 'bg-green-100 text-green-800 border-green-200';
      case 'partial': return 'bg-yellow-100 text-yellow-800 border-yellow-200';  
      case 'planned': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'low': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6 mb-6">
          <h1 className="text-3xl font-bold text-base-content mb-4">
            Lace Design System
          </h1>
          <p className="text-base-content/70 mb-4">
            Following YAGNI principles - documenting only what we need to implement 
            for backend integration and core functionality.
          </p>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span>Implemented</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span>Partial</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              <span>Planned</span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {designSections.map((section) => (
            <div 
              key={section.id}
              className="bg-base-100 rounded-lg border border-base-300 overflow-hidden"
            >
              <button
                onClick={() => toggleSection(section.id)}
                className="w-full p-4 text-left hover:bg-base-200 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="flex gap-2">
                    <span className={`px-2 py-1 text-xs font-medium rounded border ${getStatusColor(section.status)}`}>
                      {section.status}
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded border ${getPriorityColor(section.priority)}`}>
                      {section.priority}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-base-content">
                    {section.title}
                  </h3>
                </div>
                {expandedSections.has(section.id) ? (
                  <ChevronDownIcon className="w-5 h-5 text-base-content/60" />
                ) : (
                  <ChevronRightIcon className="w-5 h-5 text-base-content/60" />
                )}
              </button>
              
              {expandedSections.has(section.id) && (
                <div className="px-4 pb-4 border-t border-base-300">
                  <p className="text-base-content/80 mb-4 mt-4">
                    {section.description}
                  </p>
                  
                  {section.backendIntegration && (
                    <div>
                      <h4 className="font-medium text-base-content mb-2">
                        Backend Integration Requirements:
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-base-content/70">
                        {section.backendIntegration.map((requirement, index) => (
                          <li key={index}>{requirement}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="bg-base-100 rounded-lg shadow-sm border border-base-300 p-6 mt-6">
          <h2 className="text-xl font-bold text-base-content mb-4">
            Implementation Priority
          </h2>
          <div className="space-y-2 text-sm">
            <p className="text-base-content/80">
              <strong>Next Sprint:</strong> Carousel component system for rich timeline entries
            </p>
            <p className="text-base-content/80">
              <strong>Following Sprint:</strong> External integration timeline entries
            </p>
            <p className="text-base-content/80">
              <strong>Future:</strong> Modal system, advanced animations (YAGNI - implement when needed)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
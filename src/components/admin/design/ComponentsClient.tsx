'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

interface ComponentStats {
  atoms: number;
  molecules: number;
  organisms: number;
  templates: number;
  pages: number;
}

interface RecentImplementation {
  name: string;
  type: string;
  status: string;
  priority: string;
}

interface ComponentsClientProps {
  componentStats: ComponentStats;
  recentImplementations: RecentImplementation[];
}

export function ComponentsClient({ componentStats, recentImplementations }: ComponentsClientProps) {
  const [currentTheme, setCurrentTheme] = useState('dark');

  return (
    <>
      {/* Live Examples */}
      <div className="bg-base-100 rounded-lg border border-base-300 p-6">
        <h2 className="text-xl font-bold text-base-content mb-4">Live Examples</h2>
        
        {/* Icon System */}
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Hybrid Icon System</h3>
          <p className="text-base-content/70 text-sm mb-3">
            FontAwesome for rich icons + Heroicons for chevrons/navigation
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-2">FontAwesome Icons</h4>
              <div className="flex gap-4 items-center p-3 border border-base-300 rounded">
                <FontAwesomeIcon icon={faSearch} className="w-6 h-6 text-base-content" />
                <FontAwesomeIcon icon={faTerminal} className="w-6 h-6 text-base-content" />
                <FontAwesomeIcon icon={faTasks} className="w-6 h-6 text-base-content" />
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Heroicons Navigation</h4>
              <div className="flex gap-4 items-center p-3 border border-base-300 rounded">
                <ChevronDownIcon className="w-6 h-6 text-base-content" />
                <ChevronRightIcon className="w-6 h-6 text-base-content" />
              </div>
            </div>
          </div>
        </div>

        {/* Theme System */}
        <div className="mb-6">
          <h3 className="font-semibold mb-3">DaisyUI Theme System</h3>
          <p className="text-base-content/70 text-sm mb-3">
            Local theme switching with localStorage persistence
          </p>

          <div className="grid grid-cols-3 gap-2 max-w-md mb-3">
            {['light', 'dark', 'cupcake', 'corporate', 'synthwave', 'cyberpunk'].map((theme) => (
              <button
                key={theme}
                onClick={() => setCurrentTheme(theme)}
                className={`p-3 rounded-lg border-2 text-sm transition-all ${
                  currentTheme === theme ? 'border-primary' : 'border-base-300'
                }`}
              >
                <div className="w-full h-4 rounded flex overflow-hidden mb-1">
                  <div className="flex-1 bg-primary"></div>
                  <div className="flex-1 bg-secondary"></div>
                  <div className="flex-1 bg-accent"></div>
                </div>
                <span className="capitalize">{theme}</span>
              </button>
            ))}
          </div>

          <div className="p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> Themes persist via localStorage, can be extended
            to user preferences API
          </div>
        </div>

        {/* Timeline System */}
        <div>
          <h3 className="font-semibold mb-3">Timeline System</h3>
          <p className="text-base-content/70 text-sm mb-3">
            Message components with different types and interactive elements
          </p>

          <div className="border border-base-300 rounded p-4 bg-base-50">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                  <FontAwesomeIcon icon={faSearch} className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">Human Message</div>
                  <div className="text-sm text-base-content/70">Can you help me with this task?</div>
                </div>
                <div className="text-xs text-base-content/60">2:30 PM</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-secondary/20 rounded-full flex items-center justify-center">
                  <FontAwesomeIcon icon={faTerminal} className="w-4 h-4 text-secondary" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">AI Response</div>
                  <div className="text-sm text-base-content/70">I'd be happy to help! Let me analyze your request...</div>
                </div>
                <div className="text-xs text-base-content/60">2:31 PM</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-accent/20 rounded-full flex items-center justify-center">
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse"></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse delay-100"></div>
                    <div className="w-1.5 h-1.5 bg-accent rounded-full animate-pulse delay-200"></div>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="font-medium text-sm">AI Thinking</div>
                  <div className="text-sm text-base-content/70">Processing your request...</div>
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-base-200 rounded text-sm">
              <strong>Backend Integration:</strong> Connected to event-sourcing system, reconstructs
              conversation state from stored events
            </div>
          </div>
        </div>
      </div>

      {/* Implementation Status */}
      <div className="bg-base-100 rounded-lg border border-base-300 p-6">
        <h2 className="text-xl font-bold text-base-content mb-4">Actually Implemented Components</h2>
        <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
          <p className="text-sm text-green-700">
            <strong>Discovery:</strong> Deep audit revealed we have most features implemented! 
            Components organized by domain rather than atomic levels.
          </p>
        </div>
        <div className="space-y-3">
          {recentImplementations.map((component, index) => (
            <div key={index} className="flex items-center justify-between p-3 border border-base-300 rounded">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${
                  component.status === 'implemented' ? 'bg-success' :
                  component.status === 'partial' ? 'bg-warning' : 'bg-info'
                }`}></div>
                <div>
                  <div className="font-medium">{component.name}</div>
                  <div className="text-sm text-base-content/60">{component.type}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className={`badge badge-sm ${
                  component.status === 'implemented' ? 'badge-success' :
                  component.status === 'partial' ? 'badge-warning' : 'badge-info'
                }`}>
                  {component.status}
                </div>
                <div className={`badge badge-outline badge-sm ${
                  component.priority === 'high' ? 'badge-error' :
                  component.priority === 'medium' ? 'badge-warning' : 'badge-info'
                }`}>
                  {component.priority}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
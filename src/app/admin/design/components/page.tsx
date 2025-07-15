'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks } from '~/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

export default function ComponentsPage() {
  const [currentTheme, setCurrentTheme] = useState('dark');

  const componentStats = {
    atoms: 12,
    molecules: 8,
    organisms: 6,
    templates: 4,
    pages: 3
  };

  const recentImplementations = [
    { name: 'Voice Recognition UI', type: 'Organism', status: 'partial', priority: 'medium' },
    { name: 'Timeline Message', type: 'Molecule', status: 'implemented', priority: 'high' },
    { name: 'Theme Selector', type: 'Molecule', status: 'implemented', priority: 'medium' },
    { name: 'Modal System', type: 'Organism', status: 'planned', priority: 'medium' },
  ];

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Component Overview</h1>
          <p className="text-base-content/70 mb-4">
            Current implementation status of our atomic design system components and design patterns that connect to our backend systems.
          </p>
          <div className="flex items-center gap-4">
            <Link href="/admin/design" className="btn btn-primary btn-sm">
              View Full Design System
            </Link>
            <div className="text-sm text-base-content/60">
              Total: {Object.values(componentStats).reduce((a, b) => a + b, 0)} components across 5 levels
            </div>
          </div>
        </div>

        {/* Component Statistics */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(componentStats).map(([level, count]) => (
            <Link
              key={level}
              href={`/admin/design/${level}`}
              className="bg-base-100 border border-base-300 rounded-lg p-4 hover:border-primary hover:bg-primary/5 transition-colors group"
            >
              <div className="text-center">
                <div className="text-2xl font-bold text-base-content group-hover:text-primary transition-colors">
                  {count}
                </div>
                <div className="font-medium capitalize">{level}</div>
                <div className="text-xs text-base-content/60 mt-1">
                  {level === 'atoms' && 'Basic elements'}
                  {level === 'molecules' && 'Simple combinations'}
                  {level === 'organisms' && 'Complex sections'}
                  {level === 'templates' && 'Layout patterns'}
                  {level === 'pages' && 'Complete experiences'}
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Access to Atomic Levels */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Atomic Design Levels</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            
            <Link href="/admin/design/atoms" className="border border-base-300 rounded-lg p-4 hover:border-primary hover:bg-primary/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-primary/10 group-hover:bg-primary/20 text-primary rounded-full flex items-center justify-center font-bold">
                  A
                </div>
                <h3 className="font-semibold group-hover:text-primary transition-colors">Atoms</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Design tokens, buttons, icons, form inputs, and basic building blocks
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-success badge-sm">12 components</div>
                <div className="badge badge-outline badge-sm">Foundation</div>
              </div>
            </Link>

            <Link href="/admin/design/molecules" className="border border-base-300 rounded-lg p-4 hover:border-secondary hover:bg-secondary/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-secondary/10 group-hover:bg-secondary/20 text-secondary rounded-full flex items-center justify-center font-bold">
                  M
                </div>
                <h3 className="font-semibold group-hover:text-secondary transition-colors">Molecules</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Search bars, navigation items, message bubbles, and functional combinations
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-success badge-sm">8 components</div>
                <div className="badge badge-outline badge-sm">Functional</div>
              </div>
            </Link>

            <Link href="/admin/design/organisms" className="border border-base-300 rounded-lg p-4 hover:border-accent hover:bg-accent/5 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 bg-accent/10 group-hover:bg-accent/20 text-accent rounded-full flex items-center justify-center font-bold">
                  O
                </div>
                <h3 className="font-semibold group-hover:text-accent transition-colors">Organisms</h3>
              </div>
              <p className="text-sm text-base-content/70 mb-3">
                Timeline views, sidebar navigation, modals, and complete interface sections
              </p>
              <div className="flex items-center gap-2">
                <div className="badge badge-warning badge-sm">6 components</div>
                <div className="badge badge-outline badge-sm">Complex</div>
              </div>
            </Link>

          </div>
        </div>

        {/* Implementation Status */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Recent Implementations</h2>
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

        {/* Current Implementations Showcase */}
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

        {/* Next Steps */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Development Roadmap</h2>
          <div className="grid md:grid-cols-3 gap-6">
            
            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-success rounded-full"></div>
                <h3 className="font-semibold">Current Sprint</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Atomic design foundation</li>
                <li>• Core atom library</li>
                <li>• Design token system</li>
                <li>• Component documentation</li>
              </ul>
            </div>

            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-warning rounded-full"></div>
                <h3 className="font-semibold">Next Sprint</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Molecule composition</li>
                <li>• Carousel components</li>
                <li>• Modal system organisms</li>
                <li>• Enhanced interactions</li>
              </ul>
            </div>

            <div className="border border-base-300 rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-3 h-3 bg-info rounded-full"></div>
                <h3 className="font-semibold">Future</h3>
              </div>
              <ul className="space-y-2 text-sm text-base-content/80">
                <li>• Template systems</li>
                <li>• Advanced animations</li>
                <li>• Integration components</li>
                <li>• Performance optimization</li>
              </ul>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
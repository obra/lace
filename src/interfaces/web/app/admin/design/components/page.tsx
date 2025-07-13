'use client';

import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearch, faTerminal, faTasks } from '~/interfaces/web/lib/fontawesome';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';

export default function ComponentsPage() {
  const [currentTheme, setCurrentTheme] = useState('dark');

  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">Implemented Components</h1>
          <p className="text-base-content/70">
            Current design patterns and components that connect to our backend
          </p>
        </div>

        {/* Icon System */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Hybrid Icon System</h2>
          <p className="text-base-content/70 mb-4">
            FontAwesome for rich icons + Heroicons for chevrons/navigation
          </p>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">FontAwesome Icons</h3>
              <div className="flex gap-4 items-center">
                <FontAwesomeIcon icon={faSearch} className="w-6 h-6 text-base-content" />
                <FontAwesomeIcon icon={faTerminal} className="w-6 h-6 text-base-content" />
                <FontAwesomeIcon icon={faTasks} className="w-6 h-6 text-base-content" />
              </div>
              <code className="text-xs text-base-content/60 block mt-2">
                {`<FontAwesomeIcon icon={faSearch} className="w-6 h-6" />`}
              </code>
            </div>

            <div>
              <h3 className="font-semibold mb-3">Heroicons Chevrons</h3>
              <div className="flex gap-4 items-center">
                <ChevronDownIcon className="w-6 h-6 text-base-content" />
                <ChevronRightIcon className="w-6 h-6 text-base-content" />
              </div>
              <code className="text-xs text-base-content/60 block mt-2">
                {`<ChevronDownIcon className="w-6 h-6" />`}
              </code>
            </div>
          </div>
        </div>

        {/* DaisyUI Theme System */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">DaisyUI Theme System</h2>
          <p className="text-base-content/70 mb-4">
            Local theme switching with localStorage persistence
          </p>

          <div className="grid grid-cols-3 gap-2 max-w-md">
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

          <div className="mt-4 p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> Themes persist via localStorage, can be extended
            to user preferences API
          </div>
        </div>

        {/* Responsive Layout */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">
            Mobile-First Responsive Layout
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3">Desktop Pattern</h3>
              <div className="bg-base-200 rounded p-3 text-sm">
                <div className="border border-base-300 rounded p-2 mb-2">
                  <strong>Collapsible Sidebar</strong>
                  <ul className="text-xs mt-1 text-base-content/70">
                    <li>• Width toggles between 350px and 64px</li>
                    <li>• Heroicons chevrons for expand/collapse</li>
                    <li>• Smooth transitions with Tailwind</li>
                  </ul>
                </div>
                <div className="border border-base-300 rounded p-2">
                  <strong>Main Content Area</strong>
                  <ul className="text-xs mt-1 text-base-content/70">
                    <li>• Timeline view with scroll</li>
                    <li>• Fixed chat input at bottom</li>
                  </ul>
                </div>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-3">Mobile Pattern</h3>
              <div className="bg-base-200 rounded p-3 text-sm">
                <div className="border border-base-300 rounded p-2 mb-2">
                  <strong>Overlay Sidebar</strong>
                  <ul className="text-xs mt-1 text-base-content/70">
                    <li>• Full-height overlay with backdrop</li>
                    <li>• Slide-in animation from left</li>
                    <li>• Touch-friendly close button</li>
                  </ul>
                </div>
                <div className="border border-base-300 rounded p-2">
                  <strong>Quick Actions Bar</strong>
                  <ul className="text-xs mt-1 text-base-content/70">
                    <li>• Collapsible action buttons</li>
                    <li>• Voice input for mobile</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> Layout state can be persisted, responsive
            breakpoints optimize for different API call patterns
          </div>
        </div>

        {/* Timeline Components */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Timeline System</h2>

          <div className="space-y-4">
            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">TimelineMessage Component</h3>
              <p className="text-sm text-base-content/70 mb-2">
                Handles different message types with proper styling and avatars
              </p>
              <div className="text-xs font-mono bg-base-200 p-2 rounded">
                {`type: 'admin' | 'human' | 'ai' | 'tool' | 'integration' | 'carousel'`}
              </div>
            </div>

            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">TypingIndicator Component</h3>
              <p className="text-sm text-base-content/70 mb-2">
                Shows AI thinking state with animated dots
              </p>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                  <FontAwesomeIcon icon={faSearch} className="w-3 h-3 text-primary-content" />
                </div>
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse"></div>
                  <div
                    className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse"
                    style={{ animationDelay: '0.2s' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-base-content/40 rounded-full animate-pulse"
                    style={{ animationDelay: '0.4s' }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> Connected to event-sourcing system, reconstructs
            conversation state from stored events
          </div>
        </div>

        {/* Voice Recognition */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">Voice Recognition (Partial)</h2>

          <div className="flex items-center gap-4 mb-4">
            <button className="btn btn-primary">
              <FontAwesomeIcon icon={faSearch} className="w-4 h-4 mr-2" />
              Start Listening
            </button>
            <div className="text-sm text-base-content/70">
              Web Speech API integration with TypeScript interfaces
            </div>
          </div>

          <div className="p-3 bg-base-200 rounded text-sm">
            <strong>Status:</strong> Basic functionality implemented.
            <strong>Missing:</strong> Waveform visualization, better mobile UX
          </div>
        </div>
      </div>
    </div>
  );
}

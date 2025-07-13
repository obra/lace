'use client';

import { ChevronRightIcon } from '@heroicons/react/24/outline';

export default function MissingComponentsPage() {
  return (
    <div className="min-h-screen bg-base-200 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h1 className="text-3xl font-bold text-base-content mb-2">
            Components We Need to Build
          </h1>
          <p className="text-base-content/70">
            YAGNI-focused list of missing components required for backend integration
          </p>
        </div>

        {/* High Priority - Carousel System */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs font-medium rounded border bg-red-100 text-red-800 border-red-200">
              HIGH PRIORITY
            </span>
            <h2 className="text-xl font-bold text-base-content">
              Carousel Timeline Component
            </h2>
          </div>
          
          <div className="space-y-4">
            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">Code Changes Carousel</h3>
              <div className="bg-base-200 p-3 rounded text-sm">
                <div className="flex gap-4 mb-2">
                  <span className="badge badge-primary">feature</span>
                  <span className="text-base-content/60">commit: abc123f</span>
                </div>
                <div className="space-y-1 text-xs">
                  <div>📄 src/api/users.ts</div>
                  <div>📄 src/components/UserList.tsx</div>
                  <div className="text-base-content/60">+ 3 more files...</div>
                </div>
                <div className="flex gap-1 mt-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full" title="High impact"></div>
                  <div className="w-2 h-2 bg-yellow-500 rounded-full" title="Medium impact"></div>
                  <div className="w-2 h-2 bg-green-500 rounded-full" title="Low impact"></div>
                </div>
              </div>
              <div className="mt-3 text-sm text-base-content/70">
                <strong>Backend needs:</strong> File change detection, git integration, impact analysis
              </div>
            </div>

            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">Carousel Navigation</h3>
              <div className="flex items-center justify-between bg-base-200 p-3 rounded">
                <button className="btn btn-sm btn-circle">‹</button>
                <div className="flex gap-1">
                  <div className="w-2 h-2 bg-primary rounded-full"></div>
                  <div className="w-2 h-2 bg-base-content/20 rounded-full"></div>
                  <div className="w-2 h-2 bg-base-content/20 rounded-full"></div>
                </div>
                <button className="btn btn-sm btn-circle">›</button>
              </div>
              <div className="mt-3 text-sm text-base-content/70">
                <strong>Features:</strong> Touch/swipe support, keyboard navigation, auto-scroll
              </div>
            </div>
          </div>
        </div>

        {/* High Priority - Integration Entries */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs font-medium rounded border bg-red-100 text-red-800 border-red-200">
              HIGH PRIORITY  
            </span>
            <h2 className="text-xl font-bold text-base-content">
              External Integration Timeline Entries
            </h2>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">Google Drive Integration</h3>
              <div className="bg-base-200 p-3 rounded text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 bg-blue-500 rounded flex items-center justify-center text-white text-xs">
                    📊
                  </div>
                  <span className="font-medium">Shared "Project Analysis.xlsx"</span>
                </div>
                <div className="text-xs text-base-content/60">
                  Created by Claude • 2 minutes ago
                </div>
                <button className="btn btn-xs btn-outline mt-2">
                  Open in Drive
                </button>
              </div>
            </div>

            <div className="border border-base-300 rounded p-4">
              <h3 className="font-semibold mb-2">Slack Integration</h3>
              <div className="bg-base-200 p-3 rounded text-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 bg-purple-500 rounded flex items-center justify-center text-white text-xs">
                    #
                  </div>
                  <span className="font-medium">Posted to #dev-team</span>
                </div>
                <div className="text-xs text-base-content/60">
                  "Code review completed for user auth feature"
                </div>
                <button className="btn btn-xs btn-outline mt-2">
                  View in Slack  
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> OAuth connectors, webhook handlers, 
            external API abstraction layer, integration event tracking
          </div>
        </div>

        {/* Medium Priority - Modals */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs font-medium rounded border bg-orange-100 text-orange-800 border-orange-200">
              MEDIUM PRIORITY
            </span>
            <h2 className="text-xl font-bold text-base-content">
              Modal System
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="border border-base-300 rounded p-3">
              <h3 className="font-semibold text-sm mb-2">Task Board Modal</h3>
              <div className="text-xs text-base-content/70 space-y-1">
                <div>• Kanban-style task management</div>
                <div>• Drag & drop functionality</div>
                <div>• Priority and assignment</div>
              </div>
            </div>

            <div className="border border-base-300 rounded p-3">
              <h3 className="font-semibold text-sm mb-2">File Manager Overlay</h3>
              <div className="text-xs text-base-content/70 space-y-1">
                <div>• Tree view of project files</div>
                <div>• Search and filter</div>
                <div>• Quick file actions</div>
              </div>
            </div>

            <div className="border border-base-300 rounded p-3">
              <h3 className="font-semibold text-sm mb-2">Command Palette</h3>
              <div className="text-xs text-base-content/70 space-y-1">
                <div>• Cmd+K to open</div>
                <div>• Fuzzy search commands</div>
                <div>• Quick tool access</div>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-base-200 rounded text-sm">
            <strong>Backend Integration:</strong> Task management API, file system abstraction, 
            command registry and execution
          </div>
        </div>

        {/* Voice Recognition Enhancement */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-1 text-xs font-medium rounded border bg-orange-100 text-orange-800 border-orange-200">
              MEDIUM PRIORITY
            </span>
            <h2 className="text-xl font-bold text-base-content">
              Enhanced Voice Recognition UI
            </h2>
          </div>

          <div className="border border-base-300 rounded p-4">
            <h3 className="font-semibold mb-2">Waveform Visualization</h3>
            <div className="bg-base-200 p-3 rounded">
              <div className="flex items-end justify-center gap-1 h-12">
                {[...Array(20)].map((_, i) => (
                  <div 
                    key={i} 
                    className="bg-primary rounded-t w-1 animate-pulse"
                    style={{ 
                      height: `${Math.random() * 100}%`,
                      animationDelay: `${i * 0.1}s`
                    }}
                  ></div>
                ))}
              </div>
              <div className="text-center text-sm mt-2 text-base-content/70">
                Listening... (tap to stop)
              </div>
            </div>
            <div className="mt-3 text-sm text-base-content/70">
              <strong>Features needed:</strong> Real-time audio level detection, 
              mobile-optimized controls, transcription display
            </div>
          </div>
        </div>

        {/* Implementation Notes */}
        <div className="bg-base-100 rounded-lg border border-base-300 p-6">
          <h2 className="text-xl font-bold text-base-content mb-4">
            Implementation Strategy (YAGNI)
          </h2>
          
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <ChevronRightIcon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <div>
                <strong>Sprint 1:</strong> Build basic Carousel component with horizontal scroll 
                and navigation dots. Start with simple text/file list carousels.
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <ChevronRightIcon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <div>
                <strong>Sprint 2:</strong> Add integration timeline entries for Google Drive/Sheets. 
                Build OAuth flow and basic external API connectors.
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <ChevronRightIcon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
              <div>
                <strong>Future:</strong> Modal system and voice enhancements only when user workflows 
                demand them. Avoid building unused features.
              </div>
            </div>
          </div>

          <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded text-sm">
            <strong>YAGNI Principle:</strong> Each component should solve a specific user need 
            and have clear backend integration requirements before development.
          </div>
        </div>

      </div>
    </div>
  );
}
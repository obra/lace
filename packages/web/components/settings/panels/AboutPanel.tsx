// ABOUTME: About panel showing version information and helpful links
// ABOUTME: Provides access to documentation, support, and system information

'use client';

import React from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';

export function AboutPanel() {
  return (
    <SettingsPanel title="About Lace">
      <div className="space-y-6">
        {/* Version Info */}
        <div className="bg-base-50 border border-base-200 rounded-lg p-6">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
              <span className="text-2xl">🧵</span>
            </div>
            <div>
              <h3 className="text-lg font-semibold">Lace AI Assistant</h3>
              <div className="text-sm text-base-content/60">Version 2.1.0</div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="font-medium text-base-content/80">License</div>
              <div className="text-base-content/60">MIT</div>
            </div>
            <div>
              <div className="font-medium text-base-content/80">Build</div>
              <div className="text-base-content/60">2025.01.04</div>
            </div>
            <div>
              <div className="font-medium text-base-content/80">Node.js</div>
              <div className="text-base-content/60">{typeof window !== 'undefined' ? 'Client' : process.version}</div>
            </div>
            <div>
              <div className="font-medium text-base-content/80">Platform</div>
              <div className="text-base-content/60">{typeof window !== 'undefined' ? navigator.platform : process.platform}</div>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid gap-3">
          <h4 className="font-medium text-base-content/80">Resources</h4>
          
          <a 
            href="https://github.com/obra/lace" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-base-50 hover:bg-base-100 border border-base-200 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">📚</span>
              <div>
                <div className="font-medium">Documentation</div>
                <div className="text-sm text-base-content/60">User guides and API reference</div>
              </div>
            </div>
            <span className="text-base-content/40 group-hover:text-base-content/60">↗</span>
          </a>

          <a 
            href="https://github.com/obra/lace/issues" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-base-50 hover:bg-base-100 border border-base-200 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">🐛</span>
              <div>
                <div className="font-medium">Report Issues</div>
                <div className="text-sm text-base-content/60">Bug reports and feature requests</div>
              </div>
            </div>
            <span className="text-base-content/40 group-hover:text-base-content/60">↗</span>
          </a>

          <a 
            href="https://github.com/obra/lace/discussions" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-base-50 hover:bg-base-100 border border-base-200 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">💬</span>
              <div>
                <div className="font-medium">Community</div>
                <div className="text-sm text-base-content/60">Join discussions and get help</div>
              </div>
            </div>
            <span className="text-base-content/40 group-hover:text-base-content/60">↗</span>
          </a>

          <a 
            href="https://github.com/obra/lace/releases" 
            target="_blank" 
            rel="noopener noreferrer"
            className="flex items-center justify-between p-3 bg-base-50 hover:bg-base-100 border border-base-200 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-3">
              <span className="text-lg">🔄</span>
              <div>
                <div className="font-medium">Release Notes</div>
                <div className="text-sm text-base-content/60">Latest updates and changes</div>
              </div>
            </div>
            <span className="text-base-content/40 group-hover:text-base-content/60">↗</span>
          </a>
        </div>

        {/* Attribution */}
        <div className="pt-4 border-t border-base-300 text-center text-sm text-base-content/50">
          <div>Built with ❤️ by the Lace team</div>
          <div className="mt-1">Powered by AI and open source technology</div>
        </div>
      </div>
    </SettingsPanel>
  );
}
// ABOUTME: Provider configuration panel for settings modal
// ABOUTME: Integrates provider instance management into unified configuration system

'use client';

import React from 'react';
import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';
import { SettingsPanel } from '@/components/settings/SettingsPanel';

export function ProvidersPanel() {
  return (
    <SettingsPanel title="AI Provider Configuration">
      <div className="space-y-4">
        <div className="bg-info/10 border border-info/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-info text-lg">🔗</div>
            <div className="text-sm">
              <div className="font-medium text-info mb-1">Provider Instances</div>
              <div className="text-base-content/70">
                Configure connections to AI providers like OpenAI, Anthropic, and local models. 
                Each instance can have custom endpoints, timeouts, and credentials.
              </div>
            </div>
          </div>
        </div>
        
        <div className="border border-base-300 rounded-lg p-4">
          <ProviderInstanceList />
        </div>
      </div>
    </SettingsPanel>
  );
}
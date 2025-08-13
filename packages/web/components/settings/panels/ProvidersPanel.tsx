// ABOUTME: Provider configuration panel for settings modal
// ABOUTME: Integrates provider instance management into unified configuration system

'use client';

import React from 'react';
import { ProviderInstanceList } from '@/components/providers/ProviderInstanceList';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlug, faInfoCircle } from '@/lib/fontawesome';

export function ProvidersPanel() {
  return (
    <SettingsPanel title="AI Provider Configuration">
      <div className="space-y-6">
        {/* Intro card */}
        <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 text-accent">
              <FontAwesomeIcon icon={faPlug} className="w-5 h-5" />
            </div>
            <div className="text-sm">
              <div className="font-medium text-accent mb-1">Provider Instances</div>
              <div className="text-base-content/75 leading-relaxed">
                Configure connections to providers like OpenAI, Anthropic, and local models. Each instance can
                define endpoints, timeouts, and credentials for flexible routing and fallbacks.
              </div>
            </div>
          </div>
        </div>

        {/* List card */}
        <div className="rounded-xl p-5 bg-base-100/60 backdrop-blur-sm border border-base-300/60 shadow-sm">
          <ProviderInstanceList />
        </div>
      </div>
    </SettingsPanel>
  );
}
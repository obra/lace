// ABOUTME: System settings panel for debugging and advanced configuration
// ABOUTME: Provides access to debug modes, logging levels, and system preferences

'use client';

import React, { useState, useEffect } from 'react';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { SettingField } from '@/components/settings/SettingField';

export function SystemPanel() {
  const [debugMode, setDebugMode] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [analytics, setAnalytics] = useState(false);
  const [logLevel, setLogLevel] = useState('info');

  // Load settings from localStorage on mount
  useEffect(() => {
    setDebugMode(localStorage.getItem('debugMode') === 'true');
    setAutoSave(localStorage.getItem('autoSave') !== 'false'); // default true
    setAnalytics(localStorage.getItem('analytics') === 'true');
    setLogLevel(localStorage.getItem('logLevel') || 'info');
  }, []);

  const handleDebugModeChange = (enabled: boolean) => {
    setDebugMode(enabled);
    localStorage.setItem('debugMode', enabled.toString());
  };

  const handleAutoSaveChange = (enabled: boolean) => {
    setAutoSave(enabled);
    localStorage.setItem('autoSave', enabled.toString());
  };

  const handleAnalyticsChange = (enabled: boolean) => {
    setAnalytics(enabled);
    localStorage.setItem('analytics', enabled.toString());
  };

  const handleLogLevelChange = (level: string) => {
    setLogLevel(level);
    localStorage.setItem('logLevel', level);
  };

  const handleResetDefaults = () => {
    if (confirm('Reset all system settings to defaults? This cannot be undone.')) {
      // Reset to defaults
      handleDebugModeChange(false);
      handleAutoSaveChange(true);
      handleAnalyticsChange(false);
      handleLogLevelChange('info');
      
      // Clear any other system settings
      const systemKeys = ['debugMode', 'autoSave', 'analytics', 'logLevel'];
      systemKeys.forEach(key => localStorage.removeItem(key));
      
      // Reload to apply defaults
      window.location.reload();
    }
  };

  return (
    <SettingsPanel title="System Settings">
      <div className="space-y-6">
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <div className="text-warning text-lg">⚠️</div>
            <div className="text-sm">
              <div className="font-medium text-warning mb-1">Advanced Settings</div>
              <div className="text-base-content/70">
                These settings affect system behavior and debugging. Change with caution.
              </div>
            </div>
          </div>
        </div>

        <SettingField>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Debug Mode</div>
              <div className="text-sm text-base-content/60">
                Enable detailed logging and debug information
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={debugMode}
              onChange={(e) => handleDebugModeChange(e.target.checked)}
            />
          </div>
        </SettingField>

        <SettingField>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Auto-save</div>
              <div className="text-sm text-base-content/60">
                Automatically save work and preferences
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={autoSave}
              onChange={(e) => handleAutoSaveChange(e.target.checked)}
            />
          </div>
        </SettingField>

        <SettingField>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Analytics</div>
              <div className="text-sm text-base-content/60">
                Share anonymous usage data to improve the product
              </div>
            </div>
            <input
              type="checkbox"
              className="toggle toggle-primary"
              checked={analytics}
              onChange={(e) => handleAnalyticsChange(e.target.checked)}
            />
          </div>
        </SettingField>

        <SettingField>
          <div>
            <div className="font-medium mb-2">Log Level</div>
            <div className="text-sm text-base-content/60 mb-3">
              Control the verbosity of system logs
            </div>
            <select
              className="select select-bordered w-full max-w-xs"
              value={logLevel}
              onChange={(e) => handleLogLevelChange(e.target.value)}
            >
              <option value="error">Error - Critical issues only</option>
              <option value="warn">Warning - Errors and warnings</option>
              <option value="info">Info - Normal operation details</option>
              <option value="debug">Debug - Verbose diagnostic information</option>
            </select>
          </div>
        </SettingField>

        <div className="pt-4 border-t border-base-300">
          <button
            className="btn btn-outline btn-warning"
            onClick={handleResetDefaults}
          >
            Reset to Defaults
          </button>
          <div className="text-xs text-base-content/50 mt-2">
            This will reset all system settings and reload the application
          </div>
        </div>
      </div>
    </SettingsPanel>
  );
}
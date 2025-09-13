'use client';

import React, { useState } from 'react';

interface Model {
  id: string;
  name: string;
  context_window: number;
  cost_per_1m_in: number;
  cost_per_1m_out: number;
  supports_attachments?: boolean;
  can_reason?: boolean;
  supported_parameters?: string[];
}

interface ProviderModelGroupProps {
  providerName: string;
  models: Model[];
  enabledModels: string[];
  onToggleProvider: (provider: string, enabled: boolean) => void;
  onToggleModel: (modelId: string, enabled: boolean) => void;
}

export function ProviderModelGroup({
  providerName,
  models,
  enabledModels,
  onToggleProvider,
  onToggleModel,
}: ProviderModelGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const enabledCount = models.filter((m) => enabledModels.includes(m.id)).length;
  const isProviderEnabled = enabledCount > 0;

  const formatContext = (tokens: number): string => {
    if (tokens >= 1000000) return `${Math.floor(tokens / 1000000)}M`;
    if (tokens >= 1000) return `${Math.floor(tokens / 1000)}k`;
    return tokens.toString();
  };

  const formatPrice = (price: number): string => {
    return price === 0 ? 'FREE' : `$${price.toFixed(2)}`;
  };

  const getCapabilityBadges = (model: Model) => {
    const badges = [];
    if (model.supports_attachments) badges.push('vision');
    if (model.can_reason) badges.push('reasoning');
    // Check for 'tools' in supported_parameters if available
    if (model.supported_parameters?.includes('tools')) {
      badges.push('tools');
    }
    return badges;
  };

  return (
    <details
      className="collapse collapse-arrow bg-base-200"
      {...(isExpanded ? { open: true } : {})}
    >
      <summary
        className="collapse-title py-3 min-h-0"
        onClick={(e) => {
          e.preventDefault();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={isProviderEnabled}
              onChange={(e) => {
                e.stopPropagation();
                onToggleProvider(providerName, e.target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
              aria-label={`${providerName} provider toggle`}
            />
            <span className="font-semibold">{providerName}</span>
          </div>
          <span className="text-sm">
            {enabledCount}/{models.length} enabled
          </span>
        </div>
      </summary>
      {isExpanded && (
        <div className="collapse-content">
          {/* Column Headers */}
          <div className="flex items-center px-3 py-2 text-xs opacity-60 border-b border-base-300 mb-2">
            <div className="flex-1 pl-8">Model</div>
            <div className="flex gap-6 text-right">
              <div className="min-w-16">Context</div>
              <div className="min-w-20">Input $/1M</div>
              <div className="min-w-20">Output $/1M</div>
            </div>
          </div>

          <div className="space-y-1">
            {models.map((model) => {
              const isEnabled = enabledModels.includes(model.id);
              const badges = getCapabilityBadges(model);

              return (
                <label
                  key={model.id}
                  className={`flex items-center p-3 bg-base-100 rounded cursor-pointer hover:bg-base-300 transition-colors ${
                    !isEnabled ? 'opacity-60' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm mr-3"
                    checked={isEnabled}
                    onChange={(e) => onToggleModel(model.id, e.target.checked)}
                  />
                  <div className="flex-1 flex items-center">
                    {/* Model name and badges - left side */}
                    <div className="flex items-center gap-2 flex-1">
                      <span className="font-medium">{model.name}</span>
                      {model.cost_per_1m_in === 0 && (
                        <span className="badge badge-xs badge-success">FREE</span>
                      )}
                      {badges.length > 0 && (
                        <div className="flex gap-1">
                          {badges.map((badge) => (
                            <span key={badge} className="badge badge-xs badge-primary">
                              {badge}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Context and pricing - right side in columns */}
                    <div className="flex gap-6 text-sm text-right">
                      <div className="min-w-16">
                        <span className="font-mono">{formatContext(model.context_window)}</span>
                      </div>
                      <div className="min-w-20">
                        <span className="font-mono">{formatPrice(model.cost_per_1m_in)}</span>
                      </div>
                      <div className="min-w-20">
                        <span className="font-mono">{formatPrice(model.cost_per_1m_out)}</span>
                      </div>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </details>
  );
}

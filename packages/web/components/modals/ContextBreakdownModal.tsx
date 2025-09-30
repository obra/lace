// ABOUTME: Modal for displaying agent context token usage breakdown
// ABOUTME: Shows detailed breakdown of token usage by category with visualization

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSpinner } from '@/lib/fontawesome';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api-client';
import type { ContextBreakdown } from '@/types/context';
import { ContextTreemap } from './ContextTreemap';

interface ContextBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
}

export function ContextBreakdownModal({ isOpen, onClose, agentId }: ContextBreakdownModalProps) {
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchBreakdown = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ContextBreakdown>(`/api/agents/${agentId}/context`);
      setBreakdown(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load context breakdown');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    if (!isOpen || !agentId) {
      return;
    }

    void fetchBreakdown();
  }, [isOpen, agentId, retryCount, fetchBreakdown]);

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1);
  };

  const formatPercent = (value: number): string => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString();
  };

  const getBarWidth = (tokens: number, total: number): string => {
    const percent = (tokens / total) * 100;
    return `${Math.min(percent, 100)}%`;
  };

  const getCategoryColor = (category: string): string => {
    switch (category) {
      case 'systemPrompt':
        return 'bg-primary';
      case 'coreTools':
        return 'bg-secondary';
      case 'mcpTools':
        return 'bg-accent';
      case 'messages':
        return 'bg-info';
      case 'reservedForResponse':
        return 'bg-warning';
      case 'freeSpace':
        return 'bg-success';
      default:
        return 'bg-base-300';
    }
  };

  if (loading) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Context Usage" size="lg">
        <div
          className="flex flex-col items-center justify-center py-12 gap-4"
          role="status"
          aria-live="polite"
        >
          <FontAwesomeIcon icon={faSpinner} className="animate-spin text-4xl text-primary" />
          <p className="text-sm text-base-content/60">Analyzing context usage...</p>
          <span className="sr-only">Loading context breakdown</span>
        </div>
      </Modal>
    );
  }

  if (error) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Context Usage" size="lg">
        <div className="alert alert-error">
          <div className="flex-1">
            <h3 className="font-bold">Failed to load context</h3>
            <div className="text-sm">{error}</div>
          </div>
          <button className="btn btn-sm" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </Modal>
    );
  }

  if (!breakdown) {
    return null;
  }

  // Check for empty conversation
  const isEmpty = breakdown.totalUsedTokens === 0;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Context Usage" size="lg">
      {isEmpty ? (
        <div className="alert alert-info">
          <span>This conversation hasn't started yet. Context is empty.</span>
        </div>
      ) : (
        <div className="space-y-6" role="document" aria-label="Context breakdown details">
          {/* Summary Stats */}
          <div className="stats stats-vertical lg:stats-horizontal w-full shadow">
            <div className="stat">
              <div className="stat-title">Context Window</div>
              <div className="stat-value text-2xl">{formatNumber(breakdown.contextLimit)}</div>
              <div className="stat-desc">Total available tokens</div>
            </div>

            <div className="stat">
              <div className="stat-title">Used Tokens</div>
              <div className="stat-value text-2xl">{formatNumber(breakdown.totalUsedTokens)}</div>
              <div className="stat-desc">{formatPercent(breakdown.percentUsed)} of context</div>
            </div>

            <div className="stat">
              <div className="stat-title">Free Space</div>
              <div className="stat-value text-2xl">
                {formatNumber(breakdown.categories.freeSpace.tokens)}
              </div>
              <div className="stat-desc">Available for input</div>
            </div>
          </div>

          {/* Main Content: Treemap (left) + Category Breakdown (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Interactive Treemap */}
            {breakdown.totalUsedTokens > 0 && (
              <div>
                <ContextTreemap breakdown={breakdown} />
              </div>
            )}

            {/* Right: Category Breakdown */}
            <div>
              {/* Visual Breakdown Bar */}
              <div className="space-y-2 mb-6">
                <div className="text-sm font-medium">Token Distribution</div>
                <div className="flex h-8 w-full overflow-hidden rounded-lg">
                  {breakdown.categories.systemPrompt.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('systemPrompt')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.systemPrompt.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`System Prompt: ${formatNumber(breakdown.categories.systemPrompt.tokens)} tokens`}
                    />
                  )}
                  {breakdown.categories.coreTools.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('coreTools')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.coreTools.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`Core Tools: ${formatNumber(breakdown.categories.coreTools.tokens)} tokens`}
                    />
                  )}
                  {breakdown.categories.mcpTools.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('mcpTools')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.mcpTools.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`MCP Tools: ${formatNumber(breakdown.categories.mcpTools.tokens)} tokens`}
                    />
                  )}
                  {breakdown.categories.messages.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('messages')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.messages.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`Messages: ${formatNumber(breakdown.categories.messages.tokens)} tokens`}
                    />
                  )}
                  {breakdown.categories.reservedForResponse.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('reservedForResponse')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.reservedForResponse.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`Reserved: ${formatNumber(breakdown.categories.reservedForResponse.tokens)} tokens`}
                    />
                  )}
                  {breakdown.categories.freeSpace.tokens > 0 && (
                    <div
                      className={`${getCategoryColor('freeSpace')} flex items-center justify-center text-xs text-white`}
                      style={{
                        width: getBarWidth(
                          breakdown.categories.freeSpace.tokens,
                          breakdown.contextLimit
                        ),
                      }}
                      title={`Free Space: ${formatNumber(breakdown.categories.freeSpace.tokens)} tokens`}
                    />
                  )}
                </div>
              </div>

              {/* Category Details */}
              <div className="space-y-3">
                <div className="text-sm font-medium">Category Breakdown</div>

                {/* System Prompt */}
                <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-4 w-4 rounded ${getCategoryColor('systemPrompt')}`} />
                    <span className="font-medium">System Prompt</span>
                  </div>
                  <span className="text-sm">
                    {formatNumber(breakdown.categories.systemPrompt.tokens)} tokens
                  </span>
                </div>

                {/* Core Tools */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-4 w-4 rounded ${getCategoryColor('coreTools')}`} />
                      <span className="font-medium">Core Tools</span>
                    </div>
                    <span className="text-sm">
                      {formatNumber(breakdown.categories.coreTools.tokens)} tokens
                      {breakdown.categories.coreTools.items && (
                        <span className="ml-2 text-xs opacity-60">
                          ({breakdown.categories.coreTools.items.length} tools)
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Individual core tools */}
                  {breakdown.categories.coreTools.items &&
                    breakdown.categories.coreTools.items.length > 0 && (
                      <div className="ml-7 space-y-1 text-sm">
                        {breakdown.categories.coreTools.items.map((tool) => (
                          <div key={tool.name} className="flex justify-between">
                            <span className="opacity-60">{tool.name}:</span>
                            <span>{formatNumber(tool.tokens)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </div>

                {/* MCP Tools */}
                {breakdown.categories.mcpTools.tokens > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-4 w-4 rounded ${getCategoryColor('mcpTools')}`} />
                        <span className="font-medium">MCP Tools</span>
                      </div>
                      <span className="text-sm">
                        {formatNumber(breakdown.categories.mcpTools.tokens)} tokens
                        {breakdown.categories.mcpTools.items && (
                          <span className="ml-2 text-xs opacity-60">
                            ({breakdown.categories.mcpTools.items.length} tools)
                          </span>
                        )}
                      </span>
                    </div>
                    {/* Individual MCP tools */}
                    {breakdown.categories.mcpTools.items &&
                      breakdown.categories.mcpTools.items.length > 0 && (
                        <div className="ml-7 space-y-1 text-sm">
                          {breakdown.categories.mcpTools.items.map((tool) => (
                            <div key={tool.name} className="flex justify-between">
                              <span className="opacity-60">{tool.name}:</span>
                              <span>{formatNumber(tool.tokens)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>
                )}

                {/* Messages */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                    <div className="flex items-center gap-3">
                      <div className={`h-4 w-4 rounded ${getCategoryColor('messages')}`} />
                      <span className="font-medium">Messages</span>
                    </div>
                    <span className="text-sm">
                      {formatNumber(breakdown.categories.messages.tokens)} tokens
                    </span>
                  </div>
                  {/* Message subcategories */}
                  {breakdown.categories.messages.tokens > 0 && (
                    <div className="ml-7 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="opacity-60">User Messages:</span>
                        <span>
                          {formatNumber(
                            breakdown.categories.messages.subcategories.userMessages.tokens
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-60">Agent Messages:</span>
                        <span>
                          {formatNumber(
                            breakdown.categories.messages.subcategories.agentMessages.tokens
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-60">Tool Calls:</span>
                        <span>
                          {formatNumber(
                            breakdown.categories.messages.subcategories.toolCalls.tokens
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-60">Tool Results:</span>
                        <span>
                          {formatNumber(
                            breakdown.categories.messages.subcategories.toolResults.tokens
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Reserved for Response */}
                <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-4 w-4 rounded ${getCategoryColor('reservedForResponse')}`} />
                    <span className="font-medium">Reserved for Response</span>
                  </div>
                  <span className="text-sm">
                    {formatNumber(breakdown.categories.reservedForResponse.tokens)} tokens
                  </span>
                </div>

                {/* Free Space */}
                <div className="flex items-center justify-between rounded-lg bg-base-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-4 w-4 rounded ${getCategoryColor('freeSpace')}`} />
                    <span className="font-medium">Free Space</span>
                  </div>
                  <span className="text-sm">
                    {formatNumber(breakdown.categories.freeSpace.tokens)} tokens
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Model Info */}
          <div className="text-xs text-center opacity-60">
            Model: {breakdown.modelId} • Updated: {new Date(breakdown.timestamp).toLocaleString()}
          </div>
        </div>
      )}
    </Modal>
  );
}

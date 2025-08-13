// ABOUTME: List of configured provider instances with status indicators
// ABOUTME: Shows connection status, available models, and management actions

'use client';

import React, { useEffect, useState } from 'react';
import { ProviderInstanceCard } from './ProviderInstanceCard';
import { AddInstanceModal } from './AddInstanceModal';
import { parseResponse } from '@/lib/serialization';

interface ProviderInstance {
  id: string;
  displayName: string;
  catalogProviderId: string;
  hasCredentials: boolean;
  endpoint?: string;
  timeout?: number;
  status?: 'connected' | 'error' | 'untested';
  modelCount?: number;
  lastTested?: string;
}

export function ProviderInstanceList() {
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, {
    status: 'connected' | 'error' | 'testing';
    lastTested?: string;
    message?: string;
  }>>({});

  useEffect(() => {
    loadInstances();
  }, []);

  const loadInstances = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/provider/instances');
      
      if (!response.ok) {
        throw new Error(`Failed to load instances: ${response.status}`);
      }
      
      const data = await parseResponse<{ instances: ProviderInstance[] }>(response);
      setInstances(data.instances);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (instanceId: string) => {
    try {
      const response = await fetch(`/api/provider/instances/${instanceId}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error(`Failed to delete instance: ${response.status}`);
      }
      
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete instance');
    }
  };

  const handleTest = async (instanceId: string) => {
    // Set testing state
    setTestResults(prev => ({
      ...prev,
      [instanceId]: { status: 'testing' }
    }));

    try {
      const response = await fetch(`/api/provider/instances/${instanceId}/test`, {
        method: 'POST'
      });
      
      const result = await parseResponse<{ 
        success: boolean; 
        status: 'connected' | 'error';
        message?: string;
        testedAt: string;
      }>(response);
      
      // Update test results
      setTestResults(prev => ({
        ...prev,
        [instanceId]: {
          status: result.status,
          lastTested: result.testedAt,
          message: result.message
        }
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [instanceId]: {
          status: 'error',
          lastTested: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'Test failed'
        }
      }));
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card bg-base-100 shadow-sm">
            <div className="card-body py-4">
              <div className="flex items-center space-x-3">
                <div className="w-3 h-3 bg-base-300 rounded-full animate-pulse"></div>
                <div className="flex-1">
                  <div className="h-4 bg-base-300 rounded animate-pulse mb-2"></div>
                  <div className="h-3 bg-base-300 rounded animate-pulse w-2/3"></div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error">
        <span>Error: {error}</span>
        <button className="btn btn-sm btn-ghost" onClick={loadInstances}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {instances.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <div className="mb-4">
                <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-base-content/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium mb-2">No Provider Instances</h3>
                <p className="text-base-content/60 mb-6">
                  Configure your first AI provider to start using Lace. You can connect to OpenAI, Anthropic, local models, and more.
                </p>
              </div>
              <button 
                className="btn btn-primary vapor-button"
                onClick={() => setShowAddModal(true)}
              >
                Add Your First Instance
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm text-base-content/60">
                {instances.length} instance{instances.length !== 1 ? 's' : ''} configured
              </span>
              <button 
                className="btn btn-primary vapor-button btn-sm"
                onClick={() => setShowAddModal(true)}
              >
                Add Instance
              </button>
            </div>
            
            {instances.map((instance) => {
              const testResult = testResults[instance.id];
              const instanceWithStatus = {
                ...instance,
                status: testResult?.status || 'untested',
                lastTested: testResult?.lastTested,
              };
              
              return (
                <ProviderInstanceCard
                  key={instance.id}
                  instance={instanceWithStatus}
                  onTest={() => handleTest(instance.id)}
                  onDelete={() => handleDelete(instance.id)}
                  onEdit={loadInstances} // Refresh list after edit
                />
              );
            })}
          </>
        )}
      </div>

      <AddInstanceModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSuccess={loadInstances}
      />
    </>
  );
}
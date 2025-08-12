// ABOUTME: Component for testing provider connections with real-time feedback
// ABOUTME: Shows loading states, success/error messages, and retry options

'use client';

import StatusDot from '@/components/ui/StatusDot';
import { useProviderStatus } from '@/unused/hooks/useProviderStatus';

interface ConnectionTestProps {
  instanceId: string;
  onStatusChange?: (status: string) => void;
}

export function ConnectionTest({ instanceId, onStatusChange }: ConnectionTestProps) {
  const { status, testConnection } = useProviderStatus(instanceId);

  const handleTest = async () => {
    await testConnection();
    onStatusChange?.(status.status);
  };

  const getStatusDisplay = () => {
    switch (status.status) {
      case 'testing':
        return { dot: 'info' as const, text: 'Testing...', color: 'text-info' };
      case 'connected':
        return { dot: 'success' as const, text: 'Connected', color: 'text-success' };
      case 'error':
        return { dot: 'error' as const, text: 'Connection Error', color: 'text-error' };
      default:
        return { dot: 'warning' as const, text: 'Untested', color: 'text-warning' };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <StatusDot 
            status={statusDisplay.dot} 
            size="sm" 
            pulse={status.status === 'testing'}
          />
          <span className={`text-sm ${statusDisplay.color}`}>
            {statusDisplay.text}
          </span>
        </div>
        
        <button
          className="btn btn-outline btn-sm"
          onClick={handleTest}
          disabled={status.status === 'testing'}
        >
          {status.status === 'testing' ? (
            <>
              <span className="loading loading-spinner loading-sm"></span>
              Testing...
            </>
          ) : (
            'Test Connection'
          )}
        </button>
      </div>

      {status.lastTested && (
        <p className="text-xs text-base-content/60">
          Last tested: {new Date(status.lastTested).toLocaleString()}
        </p>
      )}

      {status.error && (
        <div className="bg-error/20 p-2 rounded text-sm text-error">
          {status.error}
        </div>
      )}
    </div>
  );
}
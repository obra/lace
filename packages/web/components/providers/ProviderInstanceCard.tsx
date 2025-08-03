// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import StatusDot from '@/components/ui/StatusDot';
import Badge from '@/components/ui/Badge';

interface ProviderInstanceCardProps {
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    hasCredentials: boolean;
    endpoint?: string;
    timeout?: number;
    status?: 'connected' | 'error' | 'untested';
    modelCount?: number;
    lastTested?: string;
  };
  onTest: () => void;
  onDelete: () => void;
}

export function ProviderInstanceCard({ instance, onTest, onDelete }: ProviderInstanceCardProps) {
  const getStatusProps = (status?: string) => {
    switch (status) {
      case 'connected': 
        return { status: 'success' as const, text: 'Connected' };
      case 'error': 
        return { status: 'error' as const, text: 'Connection Error' };
      default: 
        return { status: 'warning' as const, text: instance.hasCredentials ? 'Untested' : 'No Credentials' };
    }
  };

  const statusProps = getStatusProps(instance.status);

  const handleDeleteClick = () => {
    if (confirm(`Are you sure you want to delete "${instance.displayName}"? This will remove the instance and its credentials.`)) {
      onDelete();
    }
  };

  return (
    <div className="card bg-base-100 shadow-sm border border-base-300">
      <div className="card-body py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <StatusDot status={statusProps.status} size="md" />
            <div className="flex-1">
              <div className="flex items-center space-x-2 mb-1">
                <h4 className="font-medium">{instance.displayName}</h4>
                <Badge variant="outline" size="xs">
                  {instance.catalogProviderId}
                </Badge>
              </div>
              <div className="text-sm text-base-content/60 space-y-1">
                <div className="flex items-center space-x-4">
                  <span>{statusProps.text}</span>
                  {instance.modelCount !== undefined && (
                    <span>{instance.modelCount} models available</span>
                  )}
                  {instance.hasCredentials && (
                    <Badge variant="success" size="xs">Configured</Badge>
                  )}
                  {!instance.hasCredentials && (
                    <Badge variant="error" size="xs">Missing Credentials</Badge>
                  )}
                </div>
                
                {instance.endpoint && (
                  <div className="text-xs text-base-content/40">
                    Custom endpoint: {instance.endpoint}
                  </div>
                )}
                
                {instance.lastTested && (
                  <div className="text-xs text-base-content/40">
                    Last tested: {new Date(instance.lastTested).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button 
              className="btn btn-ghost btn-sm"
              onClick={onTest}
              disabled={!instance.hasCredentials}
              title={!instance.hasCredentials ? 'Add credentials to test connection' : 'Test connection'}
            >
              Test
            </button>
            <button 
              className="btn btn-outline btn-sm"
              disabled
              title="Edit functionality coming soon"
            >
              Edit
            </button>
            <button 
              className="btn btn-ghost btn-sm text-error hover:bg-error/10"
              onClick={handleDeleteClick}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
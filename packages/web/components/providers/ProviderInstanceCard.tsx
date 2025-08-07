// ABOUTME: Individual instance card with status, actions, and details
// ABOUTME: Uses StatusDot, Badge, and card components from design system

import { useState } from 'react';
import StatusDot from '@/components/ui/StatusDot';
import Badge from '@/components/ui/Badge';
import { EditInstanceModal } from './EditInstanceModal';

interface ProviderInstanceCardProps {
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    hasCredentials: boolean;
    endpoint?: string;
    timeout?: number;
    status?: 'connected' | 'error' | 'untested' | 'testing';
    modelCount?: number;
    lastTested?: string;
  };
  onTest: () => void;
  onDelete: () => void;
  onEdit?: () => void; // Optional callback after edit success
}

export function ProviderInstanceCard({ instance, onTest, onDelete, onEdit }: ProviderInstanceCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const getStatusProps = (status?: string) => {
    switch (status) {
      case 'connected': 
        return { status: 'success' as const, text: 'Connected' };
      case 'error': 
        return { status: 'error' as const, text: 'Connection Error' };
      case 'testing':
        return { status: 'info' as const, text: 'Testing...' };
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

  const handleEditSuccess = () => {
    setShowEditModal(false);
    onEdit?.(); // Call parent callback to refresh data
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
              disabled={!instance.hasCredentials || instance.status === 'testing'}
              title={!instance.hasCredentials ? 'Add credentials to test connection' : 'Test connection'}
            >
              {instance.status === 'testing' ? (
                <>
                  <span className="loading loading-spinner loading-sm"></span>
                  Testing
                </>
              ) : (
                'Test'
              )}
            </button>
            <button 
              className="btn btn-outline btn-sm"
              onClick={() => setShowEditModal(true)}
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

      <EditInstanceModal
        isOpen={showEditModal}
        instance={instance}
        onClose={() => setShowEditModal(false)}
        onSuccess={handleEditSuccess}
      />
    </div>
  );
}
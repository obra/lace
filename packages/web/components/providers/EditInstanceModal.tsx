// ABOUTME: Modal for editing existing provider instances
// ABOUTME: Allows updating display name, endpoint, and credentials

'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Badge, Alert } from '@/components/ui';
import { useProviderInstances } from './ProviderInstanceProvider';

interface EditInstanceModalProps {
  isOpen: boolean;
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    endpoint?: string;
    hasCredentials: boolean;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function EditInstanceModal({
  isOpen,
  instance,
  onClose,
  onSuccess,
}: EditInstanceModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    displayName: instance.displayName,
    endpoint: instance.endpoint || '',
    timeout: 30,
    apiKey: '',
  });

  const { updateInstance } = useProviderInstances();

  // Update form data when instance changes
  useEffect(() => {
    setFormData({
      displayName: instance.displayName,
      endpoint: instance.endpoint || '',
      timeout: 30,
      apiKey: '',
    });
  }, [instance]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setSubmitting(true);
      setError(null);

      await updateInstance(instance.id, {
        displayName: formData.displayName,
        endpoint: formData.endpoint || undefined,
        timeout: formData.timeout,
        apiKey: formData.apiKey || undefined,
      });

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update instance');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setFormData({
      displayName: instance.displayName,
      endpoint: instance.endpoint || '',
      timeout: 30,
      apiKey: '',
    });
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Edit ${instance.displayName}`} size="md">
      {error && <Alert variant="error" title="Error" description={error} className="mb-4" />}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">
            <span className="label-text">Instance Name *</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.displayName}
            onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
            placeholder="My Instance"
            required
          />
        </div>

        <div>
          <label className="label">
            <span className="label-text">API Key</span>
          </label>
          <input
            type="password"
            className="input input-bordered w-full"
            value={formData.apiKey}
            onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
            placeholder="Leave empty to keep current key"
          />
          <div className="label">
            <span className="label-text-alt">
              {instance.hasCredentials
                ? 'Leave empty to keep existing key'
                : 'No API key currently configured'}
            </span>
          </div>
        </div>

        <div>
          <label className="label">
            <span className="label-text">Provider</span>
          </label>
          <div className="flex items-center space-x-2">
            <Badge variant="primary" size="sm">
              {instance.catalogProviderId}
            </Badge>
            <span className="text-sm text-base-content/60">from catalog (cannot be changed)</span>
          </div>
        </div>

        <div>
          <label className="label">
            <span className="label-text">Custom Endpoint</span>
          </label>
          <input
            type="url"
            className="input input-bordered w-full"
            value={formData.endpoint}
            onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
            placeholder="Leave empty to use default"
          />
          <div className="label">
            <span className="label-text-alt">Optional: Override the default API endpoint</span>
          </div>
        </div>

        <div>
          <label className="label">
            <span className="label-text">Timeout (seconds)</span>
          </label>
          <input
            type="number"
            className="input input-bordered w-full"
            value={formData.timeout}
            onChange={(e) =>
              setFormData({ ...formData, timeout: parseInt(e.target.value, 10) || 30 })
            }
            placeholder="30"
            min="1"
            max="300"
          />
          <div className="label">
            <span className="label-text-alt">API request timeout in seconds (1-300)</span>
          </div>
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary vapor-button" disabled={submitting}>
            {submitting ? (
              <>
                <span className="loading loading-spinner loading-sm"></span>
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

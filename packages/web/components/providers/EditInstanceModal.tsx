// ABOUTME: Modal for editing existing provider instances
// ABOUTME: Allows updating display name, endpoint, timeout, and credentials

'use client';

import React, { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import Badge from '@/components/ui/Badge';
import { parseResponse } from '@/lib/serialization';

interface EditInstanceModalProps {
  isOpen: boolean;
  instance: {
    id: string;
    displayName: string;
    catalogProviderId: string;
    endpoint?: string;
    timeout?: number;
    hasCredentials: boolean;
  };
  onClose: () => void;
  onSuccess: () => void;
}

export function EditInstanceModal({ 
  isOpen, 
  instance, 
  onClose, 
  onSuccess 
}: EditInstanceModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    displayName: instance.displayName,
    endpoint: instance.endpoint || '',
    timeout: Math.floor((instance.timeout || 30000) / 1000), // Convert to seconds
    apiKey: ''
  });

  // Update form data when instance changes
  useEffect(() => {
    setFormData({
      displayName: instance.displayName,
      endpoint: instance.endpoint || '',
      timeout: Math.floor((instance.timeout || 30000) / 1000),
      apiKey: ''
    });
  }, [instance]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      setSubmitting(true);
      setError(null);
      
      const updateData: Record<string, unknown> = {
        displayName: formData.displayName,
        endpoint: formData.endpoint || undefined,
        timeout: formData.timeout * 1000, // Convert back to milliseconds
      };

      // Only include credential if API key was provided
      if (formData.apiKey.trim()) {
        updateData.credential = { apiKey: formData.apiKey };
      }

      const response = await fetch(`/api/provider/instances/${instance.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        const errorData = await parseResponse<{ error?: string }>(response).catch(() => ({ error: undefined }));
        throw new Error(errorData.error || `Failed to update instance: ${response.status}`);
      }

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
      timeout: Math.floor((instance.timeout || 30000) / 1000),
      apiKey: ''
    });
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Edit ${instance.displayName}`}
      size="md"
    >
      {error && (
        <div className="alert alert-error mb-4">
          <span className="text-sm">{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">
            <span className="label-text">Instance Name *</span>
          </label>
          <input
            type="text"
            className="input input-bordered w-full"
            value={formData.displayName}
            onChange={(e) => setFormData({...formData, displayName: e.target.value})}
            placeholder="My Instance"
            required
          />
        </div>

        <div>
          <label className="label">
            <span className="label-text">Provider</span>
          </label>
          <div className="flex items-center space-x-2">
            <Badge variant="primary" size="sm">{instance.catalogProviderId}</Badge>
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
            onChange={(e) => setFormData({...formData, endpoint: e.target.value})}
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
            onChange={(e) => setFormData({...formData, timeout: parseInt(e.target.value) || 30})}
            min={5}
            max={300}
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
            onChange={(e) => setFormData({...formData, apiKey: e.target.value})}
            placeholder="Leave empty to keep current key"
          />
          <div className="label">
            <span className="label-text-alt">
              {instance.hasCredentials 
                ? 'Leave empty to keep existing key' 
                : 'No API key currently configured'
              }
            </span>
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
          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={submitting}
          >
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
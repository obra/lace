// ABOUTME: Modal component for creating new projects
// ABOUTME: Handles project creation form with validation and error handling

import React, { useState } from 'react';
import { CreateProjectRequest } from '@/types/api';
import { useProjectAPI } from '@/hooks/useProjectAPI';

interface CreateProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: import('@/types/api').ProjectInfo) => void;
}

export function CreateProjectModal({ isOpen, onClose, onProjectCreated }: CreateProjectModalProps) {
  const [formData, setFormData] = useState<CreateProjectRequest>({
    name: '',
    description: '',
    workingDirectory: '',
    configuration: {},
  });

  const { createProject, loading, error } = useProjectAPI();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim() || !formData.workingDirectory.trim()) {
      return;
    }

    const project = await createProject({
      name: formData.name.trim(),
      description: formData.description?.trim() || '',
      workingDirectory: formData.workingDirectory.trim(),
      configuration: formData.configuration,
    });

    if (project) {
      onProjectCreated(project);
      onClose();
      setFormData({
        name: '',
        description: '',
        workingDirectory: '',
        configuration: {},
      });
    }
  };

  const handleClose = () => {
    onClose();
    setFormData({
      name: '',
      description: '',
      workingDirectory: '',
      configuration: {},
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
        <h2 className="text-xl font-bold mb-4">Create New Project</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-1">
              Project Name *
            </label>
            <input
              type="text"
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Enter project name"
              required
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="Enter project description"
              rows={3}
              disabled={loading}
            />
          </div>

          <div>
            <label htmlFor="workingDirectory" className="block text-sm font-medium mb-1">
              Working Directory *
            </label>
            <input
              type="text"
              id="workingDirectory"
              value={formData.workingDirectory}
              onChange={(e) => setFormData({ ...formData, workingDirectory: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              placeholder="/path/to/project"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-900/20 p-2 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={loading || !formData.name.trim() || !formData.workingDirectory.trim()}
            >
              {loading ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
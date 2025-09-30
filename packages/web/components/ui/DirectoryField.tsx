// ABOUTME: DirectoryField component for directory selection with inline browser
// ABOUTME: Provides text input with folder icon and will support dropdown directory browsing

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faSpinner,
  faChevronLeft,
  faHome,
  faFile,
  faFolderPlus,
  faExclamationTriangle,
} from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type {
  ListDirectoryResponse,
  DirectoryEntry,
  CreateDirectoryResponse,
} from '@/types/filesystem';
import { DIRECTORY_BROWSER } from '@/lib/constants/ui';
import { NewFolderDialog } from '@/components/ui/NewFolderDialog';

interface DirectoryFieldProps {
  label?: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  helpText?: string;
  className?: string;
  prepopulatePath?: boolean;
  inline?: boolean;
  minRows?: number;
}

export function DirectoryField({
  label,
  value,
  onChange,
  placeholder = 'Select directory',
  required = false,
  disabled = false,
  error = false,
  helpText,
  className = '',
  prepopulatePath = true,
  inline = false,
  minRows = DIRECTORY_BROWSER.DEFAULT_ROWS,
}: DirectoryFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [breadcrumbPaths, setBreadcrumbPaths] = useState<string[]>([]);
  const [homeDirectory, setHomeDirectory] = useState<string>('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [isNewFolderDialogOpen, setIsNewFolderDialogOpen] = useState(false);
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPathValue, setEditPathValue] = useState('');
  const hasInitializedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const requestAbortRef = useRef<AbortController | null>(null);

  // Add click outside handler
  const handleClickOutside = useCallback(
    (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        // Don't close dropdown in inline mode
        if (!inline) {
          setIsDropdownOpen(false);
        }
      }
    },
    [inline]
  );

  useEffect(() => {
    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDropdownOpen, handleClickOutside]);

  // Add debounced API call function
  const fetchDirectories = useCallback(async (path: string) => {
    setIsLoading(true);
    setApiError(null);
    setShowMore(false);

    // Abort any in-flight request before starting a new one
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;

    try {
      // If path is empty, don't include it in the query - let server use home directory
      const url = path
        ? `/api/filesystem/list?path=${encodeURIComponent(path)}`
        : '/api/filesystem/list';

      // eslint-disable-next-line no-console
      console.log('fetchDirectories requesting:', path, '→ url:', url);

      const data = await api.get<ListDirectoryResponse>(url, { signal: controller.signal });

      // eslint-disable-next-line no-console
      console.log('fetchDirectories response - currentPath:', data.currentPath);

      setEntries(data.entries);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setHomeDirectory(data.homeDirectory);

      // Use the breadcrumb information provided by the server
      setBreadcrumbs(data.breadcrumbNames);
      setBreadcrumbPaths(data.breadcrumbPaths);
    } catch (err) {
      // Treat user-initiated cancels as non-errors
      if (err instanceof Error && err.name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.error('fetchDirectories error:', err);
      setApiError(err instanceof Error ? err.message : 'Failed to load directories');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get filtered entries based on current input
  const getFilteredEntries = useCallback((): DirectoryEntry[] => {
    let filtered = entries || [];

    // Extract the search term from the current input
    // This should be the part after the last slash
    const searchTerm = value.split(/[/\\]/).pop()?.toLowerCase() || '';

    // Filter out dot files unless user is typing them
    if (!searchTerm.startsWith('.')) {
      filtered = filtered.filter((entry) => !entry.name.startsWith('.'));
    }

    // If user has typed something and we're not just showing a complete path ending with /
    if (searchTerm.length > 0 && !value.endsWith('/')) {
      filtered = filtered.filter((entry) => entry.name.toLowerCase().includes(searchTerm));
    }

    return filtered;
  }, [value, entries]);

  // Get visible entries (limited by showMore state)
  const getVisibleEntries = useCallback((): DirectoryEntry[] => {
    const filtered = getFilteredEntries();
    return showMore ? filtered : filtered.slice(0, 100);
  }, [getFilteredEntries, showMore]);

  // Initialize with home directory on first load
  useEffect(() => {
    if (!hasInitializedRef.current) {
      void fetchDirectories('');
      hasInitializedRef.current = true;
      // For inline mode, keep the directory browser open
      if (inline) {
        setIsDropdownOpen(true);
      }
    }
  }, [fetchDirectories, inline]);

  // Separate effect for prepopulating path after initialization
  useEffect(() => {
    if (prepopulatePath && hasInitializedRef.current && !value && currentPath) {
      // Add trailing slash for directory paths
      const pathWithSlash = currentPath.endsWith('/') ? currentPath : currentPath + '/';
      onChange(pathWithSlash);
    }
  }, [prepopulatePath, value, currentPath, onChange]);

  // Load directories when dropdown opens (but only on first open, not when navigating to empty dirs)
  useEffect(() => {
    if (isDropdownOpen && !isLoading && entries?.length === 0 && !currentPath) {
      // Only fetch if we don't have any entries loaded AND haven't set a current path yet
      void fetchDirectories('');
    }
  }, [isDropdownOpen, isLoading, entries?.length, currentPath, fetchDirectories]);

  // Add navigation handlers
  const handleNavigateToParent = useCallback(() => {
    if (parentPath) {
      void fetchDirectories(parentPath);
    }
  }, [parentPath, fetchDirectories]);

  const handleNavigateToHome = useCallback(() => {
    void fetchDirectories(''); // Empty string = let server determine home directory
  }, [fetchDirectories]);

  const handleBreadcrumbClick = useCallback(
    (index: number) => {
      // Use the breadcrumb paths provided by the server for accurate navigation
      if (index < breadcrumbPaths.length) {
        void fetchDirectories(breadcrumbPaths[index]);
      }
    },
    [breadcrumbPaths, fetchDirectories]
  );

  // Add directory navigation (double-click to enter)
  const handleDirectoryDoubleClick = useCallback(
    (directory: DirectoryEntry) => {
      const dirPath = directory.path.endsWith('/') ? directory.path : directory.path + '/';
      void fetchDirectories(dirPath);
      onChange(dirPath);
    },
    [fetchDirectories, onChange]
  );

  // Add directory selection handler
  const handleDirectorySelect = useCallback(
    (directory: DirectoryEntry) => {
      // Add trailing slash to make it clear it's a directory
      const dirPath = directory.path.endsWith('/') ? directory.path : directory.path + '/';
      onChange(dirPath);
      // Navigate into this directory - load its contents immediately
      void fetchDirectories(dirPath);
      // Keep dropdown open to show the new directory contents
    },
    [onChange, fetchDirectories]
  );

  // Update editPathValue when currentPath changes
  useEffect(() => {
    if (!isEditingPath) {
      setEditPathValue(currentPath);
    }
  }, [currentPath, isEditingPath]);

  // Autofocus browser container in inline mode after initialization
  useEffect(() => {
    if (inline && hasInitializedRef.current && dropdownRef.current && !isLoading) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        dropdownRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [inline, isLoading]);

  const handleOpenNewFolderDialog = useCallback(() => {
    setNewFolderError(null);
    setIsNewFolderDialogOpen(true);
  }, []);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (!currentPath) return;

      setIsCreatingFolder(true);
      setNewFolderError(null);

      try {
        const response = await api.post<CreateDirectoryResponse>('/api/filesystem/mkdir', {
          parentPath: currentPath,
          name,
        });

        // eslint-disable-next-line no-console
        console.log('Created directory:', response.path);

        // Close dialog
        setIsNewFolderDialogOpen(false);

        // Navigate into the newly created folder
        const newPath = response.path.endsWith('/') ? response.path : response.path + '/';
        // eslint-disable-next-line no-console
        console.log('Navigating to new path:', newPath);
        onChange(newPath);

        // Small delay to ensure filesystem has flushed the new directory
        await new Promise((resolve) => setTimeout(resolve, 50));

        // eslint-disable-next-line no-console
        console.log('Fetching directory contents for:', newPath);
        await fetchDirectories(newPath);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Error creating folder:', err);
        setNewFolderError(err instanceof Error ? err.message : 'Failed to create folder');
      } finally {
        setIsCreatingFolder(false);
      }
    },
    [currentPath, fetchDirectories, onChange]
  );

  // Handle keyboard input on browser to enter edit mode (Finder-style)
  const handleBrowserKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Don't interfere with New Folder dialog or if already editing
      if (isNewFolderDialogOpen || isEditingPath) return;

      // Let ESC bubble to parent modal for closing wizard
      if (e.key === 'Escape') return;

      // Check for printable characters (letters, numbers, /, etc.)
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const pathWithSlash = currentPath.endsWith('/') ? currentPath : currentPath + '/';
        setEditPathValue(pathWithSlash + e.key);
        setIsEditingPath(true);
        // Focus will happen in useEffect
      }
    },
    [isNewFolderDialogOpen, isEditingPath, currentPath]
  );

  // Focus path input when entering edit mode
  useEffect(() => {
    if (isEditingPath && pathInputRef.current) {
      pathInputRef.current.focus();
      pathInputRef.current.setSelectionRange(
        pathInputRef.current.value.length,
        pathInputRef.current.value.length
      );
    }
  }, [isEditingPath]);

  // Handle path input changes
  const handlePathInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditPathValue(e.target.value);
  }, []);

  // Handle path input submit
  const handlePathInputSubmit = useCallback(() => {
    if (editPathValue.trim()) {
      const pathWithSlash = editPathValue.endsWith('/') ? editPathValue : editPathValue + '/';
      onChange(pathWithSlash);
      void fetchDirectories(pathWithSlash);
    }
    setIsEditingPath(false);
  }, [editPathValue, onChange, fetchDirectories]);

  // Handle path input blur
  const handlePathInputBlur = useCallback(() => {
    setIsEditingPath(false);
  }, []);

  // Handle path input key down
  const handlePathInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handlePathInputSubmit();
      } else if (e.key === 'Escape') {
        // Exit edit mode but let ESC bubble to close modal
        setIsEditingPath(false);
        setEditPathValue(currentPath);
      }
    },
    [handlePathInputSubmit, currentPath]
  );

  return (
    <div className="form-control w-full">
      {label && (
        <label className="label">
          <span className="label-text">
            {label}
            {homeDirectory && (
              <span className="text-sm text-base-content/60 ml-2">inside {homeDirectory}</span>
            )}
            {required && <span className="text-error ml-1">*</span>}
          </span>
        </label>
      )}

      <div className="relative">
        {/* Directory Browser - always visible in inline mode */}
        {(isDropdownOpen || inline) && (
          <div
            ref={dropdownRef}
            className={
              inline
                ? 'mt-3 bg-base-200 border border-base-300 rounded-lg overflow-hidden w-full'
                : 'absolute z-50 left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-64 overflow-hidden'
            }
            onKeyDown={handleBrowserKeyDown}
            tabIndex={0}
          >
            {isLoading ? (
              <div className="flex flex-col items-center justify-center p-8">
                <FontAwesomeIcon
                  icon={faSpinner}
                  className="w-6 h-6 animate-spin text-primary mb-2"
                />
                <span className="text-sm text-base-content/60">Loading...</span>
              </div>
            ) : apiError ? (
              <div className="p-4">
                <div className="alert alert-error">
                  <FontAwesomeIcon icon={faExclamationTriangle} />
                  <span>{apiError}</span>
                </div>
              </div>
            ) : (
              <>
                {/* Navigation header with breadcrumbs/path input and New Folder button */}
                {!isLoading && !apiError && (
                  <div className="sticky top-0 bg-base-300 border-b border-base-content/20 px-3 py-2">
                    <div className="flex items-center gap-1 text-sm">
                      {isEditingPath ? (
                        <>
                          {/* Editable path input (Finder-style) */}
                          <input
                            ref={pathInputRef}
                            type="text"
                            value={editPathValue}
                            onChange={handlePathInputChange}
                            onBlur={handlePathInputBlur}
                            onKeyDown={handlePathInputKeyDown}
                            className="input input-bordered input-xs flex-1 font-mono text-xs"
                            data-testid="project-path-input"
                          />
                        </>
                      ) : (
                        <>
                          {/* Breadcrumb navigation */}
                          <button
                            type="button"
                            onClick={handleNavigateToHome}
                            className="btn btn-ghost btn-xs normal-case"
                            title="Go to home directory"
                          >
                            <FontAwesomeIcon icon={faHome} className="w-3 h-3" />
                          </button>
                          {breadcrumbs.length > 1 &&
                            breadcrumbs.slice(1).map((crumb, index) => (
                              <React.Fragment key={breadcrumbPaths[index + 1]}>
                                <span className="text-base-content/40">/</span>
                                <button
                                  type="button"
                                  onClick={() => handleBreadcrumbClick(index + 1)}
                                  className="btn btn-ghost btn-xs normal-case hover:text-primary truncate max-w-[150px]"
                                  title={crumb}
                                >
                                  {crumb}
                                </button>
                              </React.Fragment>
                            ))}
                        </>
                      )}
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={handleOpenNewFolderDialog}
                        className="btn btn-ghost btn-xs"
                        title="Create new folder"
                        disabled={!currentPath || isLoading}
                        data-testid="new-folder-button"
                      >
                        <FontAwesomeIcon icon={faFolderPlus} className="w-3 h-3" />
                        New Folder
                      </button>
                    </div>
                  </div>
                )}

                {/* Directory contents with fixed height in inline mode */}
                <div
                  className="overflow-y-auto"
                  style={
                    inline
                      ? { height: `${minRows * DIRECTORY_BROWSER.ROW_HEIGHT_REM}rem` }
                      : undefined
                  }
                >
                  {getFilteredEntries().length > 0 ? (
                    <>
                      {getVisibleEntries().map((entry) => (
                        <button
                          type="button"
                          key={entry.path}
                          onClick={() => entry.type === 'directory' && handleDirectorySelect(entry)}
                          onDoubleClick={() =>
                            entry.type === 'directory' && handleDirectoryDoubleClick(entry)
                          }
                          disabled={entry.type === 'file'}
                          className={`
                            w-full px-3 py-2 text-left flex items-center gap-3
                            border-b border-base-content/10 last:border-b-0
                            transition-colors duration-150
                            ${
                              entry.type === 'directory'
                                ? 'hover:bg-base-100 cursor-pointer active:bg-base-200'
                                : 'opacity-60 cursor-default bg-base-200/30'
                            }
                          `}
                          title={
                            entry.type === 'directory'
                              ? 'Click to select, double-click to open'
                              : 'Files cannot be selected'
                          }
                        >
                          <FontAwesomeIcon
                            icon={entry.type === 'directory' ? faFolder : faFile}
                            className={`
                              w-4 h-4 flex-shrink-0
                              ${entry.type === 'directory' ? 'text-primary' : 'text-base-content/30'}
                            `}
                          />
                          <span
                            className={`
                              truncate flex-1 text-sm
                              ${
                                entry.type === 'directory'
                                  ? 'text-base-content font-medium'
                                  : 'text-base-content/50 font-normal'
                              }
                            `}
                          >
                            {entry.name}
                          </span>
                          {entry.type === 'directory' && (
                            <span className="text-xs text-base-content/40 flex-shrink-0">→</span>
                          )}
                        </button>
                      ))}
                      {getFilteredEntries().length > 100 && !showMore && (
                        <div className="border-t border-base-300 p-2">
                          <button
                            type="button"
                            onClick={() => setShowMore(true)}
                            className="w-full text-center text-sm text-primary hover:text-primary-focus py-1"
                          >
                            Show {getFilteredEntries().length - 100} more items
                          </button>
                        </div>
                      )}
                      {showMore && getFilteredEntries().length > 100 && (
                        <div className="border-t border-base-300 p-2">
                          <button
                            type="button"
                            onClick={() => setShowMore(false)}
                            className="w-full text-center text-sm text-base-content/60 hover:text-base-content py-1"
                          >
                            Show less
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    !isLoading &&
                    !apiError && (
                      <div className="p-8 text-center">
                        <FontAwesomeIcon
                          icon={faFolder}
                          className="w-12 h-12 text-base-content/20 mb-3"
                        />
                        <p className="text-sm text-base-content/60">
                          {value && value.split('/').pop()
                            ? `No items matching "${value.split('/').pop()}"`
                            : 'This directory is empty'}
                        </p>
                        {!value.split('/').pop() && (
                          <button
                            type="button"
                            onClick={handleOpenNewFolderDialog}
                            className="btn btn-primary btn-sm mt-3"
                          >
                            Create First Folder
                          </button>
                        )}
                      </div>
                    )
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {helpText && (
        <label className="label">
          <span className="label-text-alt text-base-content/60">{helpText}</span>
        </label>
      )}

      <NewFolderDialog
        isOpen={isNewFolderDialogOpen}
        onClose={() => setIsNewFolderDialogOpen(false)}
        onConfirm={handleCreateFolder}
        loading={isCreatingFolder}
        error={newFolderError}
      />
    </div>
  );
}

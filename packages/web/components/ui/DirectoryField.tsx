// ABOUTME: DirectoryField component for directory selection with inline browser
// ABOUTME: Provides text input with folder icon and will support dropdown directory browsing

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faSpinner, faChevronLeft, faHome } from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import type { ListDirectoryResponse, DirectoryEntry } from '@/types/filesystem';
import { DIRECTORY_BROWSER } from '@/lib/constants/ui';

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
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [breadcrumbPaths, setBreadcrumbPaths] = useState<string[]>([]);
  const [homeDirectory, setHomeDirectory] = useState<string>('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);
  const hasInitializedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

      const data = await api.get<ListDirectoryResponse>(url, { signal: controller.signal });
      setDirectories(data.entries);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setHomeDirectory(data.homeDirectory);

      // Use the breadcrumb information provided by the server
      setBreadcrumbs(data.breadcrumbNames);
      setBreadcrumbPaths(data.breadcrumbPaths);
    } catch (err) {
      // Treat user-initiated cancels as non-errors
      if (err instanceof Error && err.name === 'AbortError') return;
      setApiError(err instanceof Error ? err.message : 'Failed to load directories');
      setDirectories([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Get filtered directories based on current input
  const getFilteredDirectories = useCallback((): DirectoryEntry[] => {
    let filtered = directories || [];

    // Extract the search term from the current input
    // This should be the part after the last slash
    const searchTerm = value.split(/[/\\]/).pop()?.toLowerCase() || '';

    // Filter out dot files unless user is typing them
    if (!searchTerm.startsWith('.')) {
      filtered = filtered.filter((dir) => !dir.name.startsWith('.'));
    }

    // If user has typed something and we're not just showing a complete path ending with /
    if (searchTerm.length > 0 && !value.endsWith('/')) {
      filtered = filtered.filter((dir) => dir.name.toLowerCase().includes(searchTerm));
    }

    return filtered;
  }, [value, directories]);

  // Get visible directories (limited by showMore state)
  const getVisibleDirectories = useCallback((): DirectoryEntry[] => {
    const filtered = getFilteredDirectories();
    return showMore ? filtered.slice(0, 100) : filtered.slice(0, 10);
  }, [getFilteredDirectories, showMore]);

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

  // Load directories when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && !isLoading && directories?.length === 0) {
      // Only fetch if we don't have any directories loaded
      void fetchDirectories('');
    }
  }, [isDropdownOpen, isLoading, directories?.length, fetchDirectories]);

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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    // If user has typed a complete directory path ending with '/', load that directory
    if (newValue.endsWith('/') && newValue !== currentPath) {
      void fetchDirectories(newValue);
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
    // Always show dropdown when focused (even in inline mode)
    setIsDropdownOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Close dropdown on Escape key
      setIsDropdownOpen(false);
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const inputClasses = ['input', 'input-bordered', 'w-full', error ? 'input-error' : '', className]
    .filter(Boolean)
    .join(' ');

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
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={inputClasses}
          aria-label={label}
          data-testid="project-path-input"
        />

        {/* Directory Browser */}
        {(isDropdownOpen || inline) && (
          <div
            ref={dropdownRef}
            className={
              inline
                ? 'mt-3 bg-base-200 border border-base-300 rounded-lg overflow-hidden'
                : 'absolute z-50 left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-64 overflow-hidden'
            }
          >
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm text-base-content/60">Loading directories...</span>
              </div>
            ) : apiError ? (
              <div className="p-4 text-sm text-error">{apiError}</div>
            ) : (
              <>
                {/* Navigation header - removed breadcrumbs and home line */}
                {!isLoading && !apiError && (
                  <div className="sticky top-0 bg-base-300 border-b border-base-content/20 p-2">
                    <div className="flex items-center gap-2">
                      {parentPath && (
                        <button
                          type="button"
                          onClick={handleNavigateToParent}
                          className="btn btn-ghost btn-xs"
                          title="Go up one level"
                        >
                          <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleNavigateToHome}
                        className="btn btn-ghost btn-xs"
                        title="Go to home directory"
                      >
                        <FontAwesomeIcon icon={faHome} className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Show filtered directory contents */}
                {getFilteredDirectories().length > 0 && (
                  <>
                    <div
                      className="overflow-y-auto"
                      style={
                        inline
                          ? { height: `${minRows * DIRECTORY_BROWSER.ROW_HEIGHT_REM}rem` }
                          : undefined
                      }
                    >
                      {getVisibleDirectories().map((dir) => (
                        <button
                          type="button"
                          key={dir.path}
                          onClick={() => handleDirectorySelect(dir)}
                          onDoubleClick={() => handleDirectoryDoubleClick(dir)}
                          className="w-full px-3 py-2 text-left hover:bg-base-100 flex items-center gap-2 border-b border-base-content/10 last:border-b-0 transition-none"
                        >
                          <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                          <span className="truncate flex-1">{dir.name}</span>
                          <span className="text-xs text-base-content/40">
                            {dir.permissions.canWrite ? 'R/W' : 'R/O'}
                          </span>
                        </button>
                      ))}
                      {getFilteredDirectories().length > 10 && !showMore && (
                        <div className="border-t border-base-300 p-2">
                          <button
                            type="button"
                            onClick={() => setShowMore(true)}
                            className="w-full text-center text-sm text-primary hover:text-primary-focus py-1"
                          >
                            Show {Math.min(90, getFilteredDirectories().length - 10)} more
                            directories
                          </button>
                        </div>
                      )}
                      {showMore && getFilteredDirectories().length > 10 && (
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
                    </div>
                  </>
                )}

                {getFilteredDirectories().length === 0 && !isLoading && !apiError && (
                  <div className="p-4 text-sm text-base-content/60 text-center">
                    {value && value.split('/').pop()
                      ? `No directories found matching "${value.split('/').pop()}"`
                      : 'No directories found'}
                  </div>
                )}
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
    </div>
  );
}

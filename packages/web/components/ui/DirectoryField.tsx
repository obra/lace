// ABOUTME: DirectoryField component for directory selection with inline browser
// ABOUTME: Provides text input with folder icon and will support dropdown directory browsing

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faSpinner, faChevronLeft, faHome } from '@/lib/fontawesome';
import { parseResponse } from '@/lib/serialization';
import type { ListDirectoryResponse, DirectoryEntry } from '@/types/filesystem';

// Browser-compatible homedir function
const getHomedir = (): string => {
  if (typeof window !== 'undefined') {
    // In browser/Storybook environment, use a mock path
    return '/home/user';
  }
  // In Node.js environment - dynamic import to avoid browser issues
  try {
    const { homedir } = require('os') as typeof import('os');
    return homedir();
  } catch {
    // Fallback if os module is not available
    return '/home/user';
  }
};

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
  className = ''
}: DirectoryFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [currentPath, setCurrentPath] = useState<string>(getHomedir());
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Add click outside handler
  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
      setIsDropdownOpen(false);
    }
  }, []);

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
    
    try {
      const response = await fetch(`/api/filesystem/list?path=${encodeURIComponent(path)}`);
      
      if (!response.ok) {
        const errorData = await parseResponse<{ error: string; code: string }>(response);
        throw new Error(errorData.error);
      }
      
      const data = await parseResponse<ListDirectoryResponse>(response);
      setDirectories(data.entries);
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      
      // Build breadcrumbs
      const home = getHomedir();
      if (data.currentPath === home) {
        setBreadcrumbs(['Home']);
      } else {
        const relativePath = data.currentPath.replace(home, '');
        const pathParts = relativePath.split('/').filter(Boolean);
        setBreadcrumbs(['Home', ...pathParts]);
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load directories');
      setDirectories([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Add autocomplete logic
  const getAutocompleteResults = useCallback((): DirectoryEntry[] => {
    if (value.length < 3) return [];
    
    // Extract parent path and search term
    const lastSlash = value.lastIndexOf('/');
    if (lastSlash === -1) return [];
    
    const parentPath = value.substring(0, lastSlash + 1);
    const searchTerm = value.substring(lastSlash + 1).toLowerCase();
    
    // Filter directories that start with search term
    return directories.filter(dir => 
      dir.name.toLowerCase().startsWith(searchTerm) &&
      dir.path.startsWith(parentPath)
    );
  }, [value, directories]);

  // Add effect to load directories when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && !isLoading && directories.length === 0) {
      // Determine which directory to load
      const pathToLoad = value.length >= 3 ? 
        value.substring(0, value.lastIndexOf('/') + 1) || getHomedir() : 
        getHomedir();
      
      void fetchDirectories(pathToLoad);
    }
  }, [isDropdownOpen, isLoading, directories.length, value, fetchDirectories]);

  // Add navigation handlers
  const handleNavigateToParent = () => {
    if (parentPath) {
      void fetchDirectories(parentPath);
    }
  };

  const handleNavigateToHome = () => {
    void fetchDirectories(getHomedir());
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === 0) {
      handleNavigateToHome();
      return;
    }
    
    const home = getHomedir();
    const pathParts = breadcrumbs.slice(1, index + 1);
    const targetPath = home + '/' + pathParts.join('/');
    void fetchDirectories(targetPath);
  };

  // Add directory navigation (double-click to enter)
  const handleDirectoryDoubleClick = (directory: DirectoryEntry) => {
    void fetchDirectories(directory.path);
  };

  // Add directory selection handler
  const handleDirectorySelect = (directory: DirectoryEntry) => {
    onChange(directory.path);
    setIsDropdownOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleFocus = () => {
    setIsFocused(true);
    setIsDropdownOpen(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  const inputClasses = [
    'input',
    'input-bordered',
    'w-full',
    'pr-10', // Space for folder icon
    error ? 'input-error' : '',
    className
  ].filter(Boolean).join(' ');

  return (
    <div className="form-control w-full">
      {label && (
        <label className="label">
          <span className="label-text">
            {label}
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
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          className={inputClasses}
          aria-label={label}
        />
        
        {/* Folder icon */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-3">
          <FontAwesomeIcon 
            icon={faFolder} 
            className="w-4 h-4 text-base-content/40" 
          />
        </div>
      </div>
      
      {/* Dropdown */}
      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-base-100 border border-base-300 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin mr-2" />
              <span className="text-sm text-base-content/60">Loading directories...</span>
            </div>
          ) : apiError ? (
            <div className="p-4 text-sm text-error">
              {apiError}
            </div>
          ) : (
            <>
              {/* Navigation header */}
              {!isLoading && !apiError && (
                <div className="sticky top-0 bg-base-200 border-b border-base-300 p-2">
                  <div className="flex items-center gap-2 mb-2">
                    {parentPath && (
                      <button
                        onClick={handleNavigateToParent}
                        className="btn btn-ghost btn-xs"
                        title="Go up one level"
                      >
                        <FontAwesomeIcon icon={faChevronLeft} className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={handleNavigateToHome}
                      className="btn btn-ghost btn-xs"
                      title="Go to home directory"
                    >
                      <FontAwesomeIcon icon={faHome} className="w-3 h-3" />
                    </button>
                  </div>
                  
                  {/* Breadcrumbs */}
                  <div className="flex items-center gap-1 text-xs">
                    {breadcrumbs.map((crumb, index) => (
                      <React.Fragment key={index}>
                        {index > 0 && <span className="text-base-content/40">/</span>}
                        <button
                          onClick={() => handleBreadcrumbClick(index)}
                          className="hover:text-primary hover:underline"
                        >
                          {crumb}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Show autocomplete results if user has typed enough */}
              {value.length >= 3 && getAutocompleteResults().length > 0 && (
                <div className="border-b border-base-300">
                  <div className="px-3 py-2 text-xs font-medium text-base-content/60 bg-base-200">
                    Matching directories
                  </div>
                  {getAutocompleteResults().map((dir) => (
                    <button
                      key={dir.path}
                      onClick={() => handleDirectorySelect(dir)}
                      className="w-full px-3 py-2 text-left hover:bg-base-200 flex items-center gap-2"
                    >
                      <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                      <span className="truncate">{dir.name}</span>
                    </button>
                  ))}
                </div>
              )}
              
              {/* Show current directory contents */}
              {directories.length > 0 && (
                <>
                  <div className="px-3 py-2 text-xs font-medium text-base-content/60 bg-base-200">
                    Browse: {currentPath}
                  </div>
                  {directories.slice(0, 10).map((dir) => (
                    <button
                      key={dir.path}
                      onClick={() => handleDirectorySelect(dir)}
                      onDoubleClick={() => handleDirectoryDoubleClick(dir)}
                      className="w-full px-3 py-2 text-left hover:bg-base-200 flex items-center gap-2 group"
                    >
                      <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                      <span className="truncate flex-1">{dir.name}</span>
                      <span className="text-xs text-base-content/40">
                        {dir.permissions.canWrite ? 'Read/Write' : 'Read Only'}
                      </span>
                      <span className="text-xs text-base-content/20 group-hover:text-base-content/60">
                        Double-click to browse
                      </span>
                    </button>
                  ))}
                  {directories.length > 10 && (
                    <div className="px-3 py-2 text-xs text-base-content/60 text-center">
                      ... and {directories.length - 10} more
                    </div>
                  )}
                </>
              )}
              
              {directories.length === 0 && !isLoading && !apiError && (
                <div className="p-4 text-sm text-base-content/60 text-center">
                  No directories found
                </div>
              )}
            </>
          )}
        </div>
      )}
      
      {helpText && (
        <label className="label">
          <span className="label-text-alt text-base-content/60">{helpText}</span>
        </label>
      )}
    </div>
  );
}
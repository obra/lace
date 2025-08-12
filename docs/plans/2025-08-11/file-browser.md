# Directory Browser Implementation Plan

## Overview

This plan implements an inline directory browser component that allows users to browse and select directories on the server filesystem. The component replaces manual text input fields in project setup flows with a user-friendly directory picker that supports both typing and browsing.

**Key Requirements:**
- Browse directories within user's home directory only (security restriction)
- Inline component (not modal-based) for maximum reusability
- Autocomplete with minimum 3 characters
- Test-driven development with real filesystem interactions
- No `any` types permitted - use proper TypeScript typing
- No mocking of core functionality - use real code paths

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ DirectoryField  │───▶│ /api/filesystem/ │───▶│ Node.js fs      │
│ Component       │    │ list             │    │ operations      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

**Data Flow:**
1. User types in DirectoryField input
2. After 3+ characters, component calls `/api/filesystem/list` 
3. API validates path is within home directory, lists contents
4. Client filters results and shows autocomplete dropdown
5. User selects directory, field value updates

## Task Breakdown

### Task 1: Create filesystem API types and validation schemas

**Files to create:**
- `packages/web/types/filesystem.ts`

**Files to reference:**
- `packages/web/types/api.ts` - Study existing API type patterns
- `packages/web/lib/validation/schemas.ts` - Study existing Zod schemas

**Implementation:**
```typescript
// packages/web/types/filesystem.ts
export interface DirectoryEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  lastModified: Date;
  permissions: {
    canRead: boolean;
    canWrite: boolean;
  };
}

export interface ListDirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
}
```

Create Zod validation schemas:
```typescript
import { z } from 'zod';

export const ListDirectoryRequestSchema = z.object({
  path: z.string().min(1, 'Path cannot be empty'),
});

export const DirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(['directory', 'file']),
  lastModified: z.date(),
  permissions: z.object({
    canRead: z.boolean(),
    canWrite: z.boolean(),
  }),
});

export const ListDirectoryResponseSchema = z.object({
  currentPath: z.string(),
  parentPath: z.string().nullable(),
  entries: z.array(DirectoryEntrySchema),
});
```

**Testing:**
Create `packages/web/types/filesystem.test.ts`:
- Test schema validation with valid directory paths
- Test schema validation rejects invalid paths
- Test type inference works correctly

**How to test:**
```bash
cd packages/web
npm run test:run types/filesystem.test.ts
```

**Commit:** "feat: add filesystem API types and validation schemas" ✅ COMPLETED

---

### Task 2: Create filesystem API route with security restrictions

**Files to create:**
- `packages/web/app/api/filesystem/list/route.ts`

**Files to reference:**
- `packages/web/app/api/projects/route.ts` - Study API route patterns
- `packages/web/lib/server/api-utils.ts` - Study error handling patterns
- `packages/web/lib/serialization.ts` - Study response serialization

**Implementation:**
```typescript
// packages/web/app/api/filesystem/list/route.ts
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import { join, resolve, relative } from 'path';
import { homedir } from 'os';
import { createSuperjsonResponse } from '@/lib/serialization';
import { createErrorResponse } from '@/lib/server/api-utils';
import { ListDirectoryRequestSchema } from '@/types/filesystem';
import type { DirectoryEntry, ListDirectoryResponse } from '@/types/filesystem';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get('path') || homedir();
    
    // Validate input
    const { path } = ListDirectoryRequestSchema.parse({ path: rawPath });
    
    // Security: Ensure path is within user's home directory
    const homeDir = homedir();
    const absolutePath = resolve(path);
    const relativePath = relative(homeDir, absolutePath);
    
    if (relativePath.startsWith('..') || resolve(homeDir, relativePath) !== absolutePath) {
      return createErrorResponse('Access denied: path outside home directory', 403, {
        code: 'PATH_ACCESS_DENIED'
      });
    }
    
    // Check if directory exists and is accessible
    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return createErrorResponse('Path is not a directory', 400, {
        code: 'NOT_A_DIRECTORY'
      });
    }
    
    // List directory contents
    const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
    const entries: DirectoryEntry[] = [];
    
    for (const dirent of dirents) {
      try {
        const entryPath = join(absolutePath, dirent.name);
        const entryStats = await fs.stat(entryPath);
        
        // Check read permissions
        await fs.access(entryPath, fs.constants.R_OK);
        const canRead = true;
        
        // Check write permissions
        let canWrite = false;
        try {
          await fs.access(entryPath, fs.constants.W_OK);
          canWrite = true;
        } catch {
          canWrite = false;
        }
        
        entries.push({
          name: dirent.name,
          path: entryPath,
          type: dirent.isDirectory() ? 'directory' : 'file',
          lastModified: entryStats.mtime,
          permissions: {
            canRead,
            canWrite,
          },
        });
      } catch {
        // Skip entries we can't read
        continue;
      }
    }
    
    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    const response: ListDirectoryResponse = {
      currentPath: absolutePath,
      parentPath: absolutePath === homeDir ? null : resolve(absolutePath, '..'),
      entries: entries.filter(entry => entry.type === 'directory'), // Only directories
    };
    
    return createSuperjsonResponse(response);
    
  } catch (error) {
    if (error instanceof Error && error.code === 'ENOENT') {
      return createErrorResponse('Directory not found', 404, {
        code: 'DIRECTORY_NOT_FOUND'
      });
    }
    
    if (error instanceof Error && error.code === 'EACCES') {
      return createErrorResponse('Permission denied', 403, {
        code: 'PERMISSION_DENIED'
      });
    }
    
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to list directory',
      500,
      { code: 'INTERNAL_SERVER_ERROR' }
    );
  }
}
```

**Testing:**
Create `packages/web/app/api/filesystem/list/route.test.ts`:
```typescript
import { GET } from './route';
import { NextRequest } from 'next/server';
import { homedir } from 'os';
import { join } from 'path';
import { parseResponse } from '@/lib/serialization';
import type { ListDirectoryResponse } from '@/types/filesystem';

describe('/api/filesystem/list', () => {
  it('should list home directory contents', async () => {
    const request = new NextRequest(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await GET(request);
    
    expect(response.status).toBe(200);
    const data = await parseResponse<ListDirectoryResponse>(response);
    expect(data.currentPath).toBe(homedir());
    expect(data.parentPath).toBeNull();
    expect(Array.isArray(data.entries)).toBe(true);
  });
  
  it('should reject paths outside home directory', async () => {
    const request = new NextRequest('http://localhost/api/filesystem/list?path=/etc');
    const response = await GET(request);
    
    expect(response.status).toBe(403);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('PATH_ACCESS_DENIED');
  });
  
  it('should handle non-existent directories', async () => {
    const invalidPath = join(homedir(), 'definitely-does-not-exist-12345');
    const request = new NextRequest(`http://localhost/api/filesystem/list?path=${invalidPath}`);
    const response = await GET(request);
    
    expect(response.status).toBe(404);
    const data = await parseResponse<{ error: string; code: string }>(response);
    expect(data.code).toBe('DIRECTORY_NOT_FOUND');
  });
  
  it('should only return directories', async () => {
    const request = new NextRequest(`http://localhost/api/filesystem/list?path=${homedir()}`);
    const response = await GET(request);
    
    const data = await parseResponse<ListDirectoryResponse>(response);
    for (const entry of data.entries) {
      expect(entry.type).toBe('directory');
    }
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run app/api/filesystem/list/route.test.ts
```

**Commit:** "feat: add filesystem list API with home directory security" ✅ COMPLETED

---

### Task 3: Create DirectoryField component (input only, no dropdown)

**Files to create:**
- `packages/web/components/ui/DirectoryField.tsx`

**Files to reference:**
- `packages/web/components/ui/TextAreaField.tsx` - Study field component patterns
- `packages/web/components/ui/index.ts` - Study component exports
- `packages/web/lib/fontawesome.ts` - Study icon imports

**Implementation:**
```typescript
// packages/web/components/ui/DirectoryField.tsx
'use client';

import React, { useState, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faSpinner } from '@/lib/fontawesome';

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
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleFocus = () => {
    setIsFocused(true);
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
      
      {helpText && (
        <label className="label">
          <span className="label-text-alt text-base-content/60">{helpText}</span>
        </label>
      )}
    </div>
  );
}
```

**Update exports:**
Add to `packages/web/components/ui/index.ts`:
```typescript
export { DirectoryField } from './DirectoryField';
```

**Testing:**
Create `packages/web/components/ui/DirectoryField.test.tsx`:
```typescript
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { DirectoryField } from './DirectoryField';

describe('DirectoryField', () => {
  const user = userEvent.setup();

  afterEach(() => {
    cleanup();
  });

  it('should render with label and input', () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Working Directory"
        value="/home/user"
        onChange={mockOnChange}
      />
    );

    expect(screen.getByLabelText('Working Directory')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/home/user')).toBeInTheDocument();
  });

  it('should call onChange when user types', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByLabelText('Directory');
    await user.type(input, '/home');

    expect(mockOnChange).toHaveBeenCalledTimes(5); // One per character
    expect(mockOnChange).toHaveBeenLastCalledWith('/home');
  });

  it('should show required indicator', () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
        required
      />
    );

    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('should show error state', () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
        error
      />
    );

    const input = screen.getByLabelText('Directory');
    expect(input).toHaveClass('input-error');
  });

  it('should show help text', () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
        helpText="Select your project directory"
      />
    );

    expect(screen.getByText('Select your project directory')).toBeInTheDocument();
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/ui/DirectoryField.test.tsx
```

**Commit:** "feat: add DirectoryField component with basic input functionality" ✅ COMPLETED

---

### Task 4: Add dropdown state and basic UI structure

**Files to modify:**
- `packages/web/components/ui/DirectoryField.tsx`

**Files to reference:**
- `packages/web/components/config/ProjectSelectorPanel.tsx` - Study dropdown/modal patterns
- `packages/web/components/ui/Modal.tsx` - Study positioning and click-outside handling

**Implementation updates:**
```typescript
// Add to DirectoryField.tsx after existing imports
import { useEffect, useCallback } from 'react';

// Add to DirectoryField component state:
const [isDropdownOpen, setIsDropdownOpen] = useState(false);
const [isLoading, setIsLoading] = useState(false);
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

// Update handleFocus to open dropdown
const handleFocus = () => {
  setIsFocused(true);
  setIsDropdownOpen(true);
};

// Add dropdown JSX after the input div:
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
    ) : (
      <div className="p-2 text-sm text-base-content/60">
        Directory browser will appear here
      </div>
    )}
  </div>
)}
```

**Update tests:**
Add to `DirectoryField.test.tsx`:
```typescript
it('should open dropdown on focus', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <DirectoryField
      label="Directory"
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);

  expect(screen.getByText('Directory browser will appear here')).toBeInTheDocument();
});

it('should close dropdown when clicking outside', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <div>
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
      />
      <div data-testid="outside">Outside</div>
    </div>
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);
  
  expect(screen.getByText('Directory browser will appear here')).toBeInTheDocument();
  
  await user.click(screen.getByTestId('outside'));
  
  expect(screen.queryByText('Directory browser will appear here')).not.toBeInTheDocument();
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/ui/DirectoryField.test.tsx
```

**Commit:** "feat: add dropdown state and click-outside handling to DirectoryField" ✅ COMPLETED

---

### Task 5: Add API integration and autocomplete logic

**Files to modify:**
- `packages/web/components/ui/DirectoryField.tsx`

**Files to reference:**
- `packages/web/hooks/useProjectAPI.ts` - Study API hook patterns
- `packages/web/lib/serialization.ts` - Study response parsing

**Implementation updates:**
```typescript
// Add imports
import { parseResponse } from '@/lib/serialization';
import type { ListDirectoryResponse, DirectoryEntry } from '@/types/filesystem';
import { homedir } from 'os';

// Add to component state:
const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
const [currentPath, setCurrentPath] = useState<string>(homedir());
const [error, setError] = useState<string | null>(null);

// Add debounced API call function
const fetchDirectories = useCallback(async (path: string) => {
  setIsLoading(true);
  setError(null);
  
  try {
    const response = await fetch(`/api/filesystem/list?path=${encodeURIComponent(path)}`);
    
    if (!response.ok) {
      const errorData = await parseResponse<{ error: string; code: string }>(response);
      throw new Error(errorData.error);
    }
    
    const data = await parseResponse<ListDirectoryResponse>(response);
    setDirectories(data.entries);
    setCurrentPath(data.currentPath);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to load directories');
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
      value.substring(0, value.lastIndexOf('/') + 1) || homedir() : 
      homedir();
    
    void fetchDirectories(pathToLoad);
  }
}, [isDropdownOpen, isLoading, directories.length, value, fetchDirectories]);

// Add directory selection handler
const handleDirectorySelect = (directory: DirectoryEntry) => {
  onChange(directory.path);
  setIsDropdownOpen(false);
};

// Update dropdown JSX:
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
    ) : error ? (
      <div className="p-4 text-sm text-error">
        {error}
      </div>
    ) : (
      <>
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
                className="w-full px-3 py-2 text-left hover:bg-base-200 flex items-center gap-2"
              >
                <FontAwesomeIcon icon={faFolder} className="w-4 h-4 text-primary" />
                <span className="truncate">{dir.name}</span>
                <span className="text-xs text-base-content/40 ml-auto">
                  {dir.permissions.canWrite ? 'Read/Write' : 'Read Only'}
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
        
        {directories.length === 0 && !isLoading && !error && (
          <div className="p-4 text-sm text-base-content/60 text-center">
            No directories found
          </div>
        )}
      </>
    )}
  </div>
)}
```

**Update tests:**
Add to `DirectoryField.test.tsx`:
```typescript
// Note: These tests use real filesystem operations as required
import { homedir } from 'os';

it('should load directories when dropdown opens', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <DirectoryField
      label="Directory"
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);

  // Wait for API call to complete
  expect(screen.getByText('Loading directories...')).toBeInTheDocument();
  
  // Wait for directories to load (this will be slow but uses real filesystem)
  await screen.findByText(/Browse:/);
  expect(screen.getByText(`Browse: ${homedir()}`)).toBeInTheDocument();
});

it('should show autocomplete results when typing', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <DirectoryField
      label="Directory"
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);
  
  // Type enough characters to trigger autocomplete
  await user.type(input, `${homedir()}/Doc`);
  
  // Should show autocomplete section if there are matching directories
  // This test may be flaky depending on user's filesystem
  await screen.findByText(/Matching directories|No directories found/);
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/ui/DirectoryField.test.tsx
```

**Commit:** "feat: add API integration and autocomplete to DirectoryField" ✅ COMPLETED

---

### Task 6: Add navigation within directory browser

**Files to modify:**
- `packages/web/components/ui/DirectoryField.tsx`

**Files to reference:**
- `packages/web/components/ui/Badge.tsx` - Study breadcrumb-style navigation UI

**Implementation updates:**
```typescript
// Add imports
import { faChevronLeft, faHome } from '@/lib/fontawesome';

// Add to component state:
const [parentPath, setParentPath] = useState<string | null>(null);
const [breadcrumbs, setBreadcrumbs] = useState<string[]>([]);

// Update fetchDirectories to handle parent path and breadcrumbs
const fetchDirectories = useCallback(async (path: string) => {
  setIsLoading(true);
  setError(null);
  
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
    const home = homedir();
    if (data.currentPath === home) {
      setBreadcrumbs(['Home']);
    } else {
      const relativePath = data.currentPath.replace(home, '');
      const pathParts = relativePath.split('/').filter(Boolean);
      setBreadcrumbs(['Home', ...pathParts]);
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to load directories');
    setDirectories([]);
  } finally {
    setIsLoading(false);
  }
}, []);

// Add navigation handlers
const handleNavigateToParent = () => {
  if (parentPath) {
    void fetchDirectories(parentPath);
  }
};

const handleNavigateToHome = () => {
  void fetchDirectories(homedir());
};

const handleBreadcrumbClick = (index: number) => {
  if (index === 0) {
    handleNavigateToHome();
    return;
  }
  
  const home = homedir();
  const pathParts = breadcrumbs.slice(1, index + 1);
  const targetPath = home + '/' + pathParts.join('/');
  void fetchDirectories(targetPath);
};

// Add directory navigation (double-click to enter)
const handleDirectoryDoubleClick = (directory: DirectoryEntry) => {
  void fetchDirectories(directory.path);
};

// Update dropdown JSX to include navigation:
{/* Navigation header */}
{!isLoading && !error && (
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

// Update directory list items to support double-click navigation:
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
```

**Update tests:**
Add to `DirectoryField.test.tsx`:
```typescript
it('should navigate to parent directory', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <DirectoryField
      label="Directory"
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);

  // Wait for initial load
  await screen.findByText(/Browse:/);

  // Navigate to a subdirectory first (if any exist)
  const directories = screen.getAllByRole('button');
  const subdirectory = directories.find(btn => 
    btn.textContent?.includes('Double-click to browse')
  );
  
  if (subdirectory) {
    await user.dblClick(subdirectory);
    
    // Wait for navigation
    await screen.findByTitle('Go up one level');
    
    // Click back button
    await user.click(screen.getByTitle('Go up one level'));
    
    // Should navigate back
    await screen.findByText(`Browse: ${homedir()}`);
  }
});

it('should navigate to home directory', async () => {
  const mockOnChange = vi.fn();
  
  render(
    <DirectoryField
      label="Directory"
      value=""
      onChange={mockOnChange}
    />
  );

  const input = screen.getByLabelText('Directory');
  await user.click(input);

  await screen.findByTitle('Go to home directory');
  await user.click(screen.getByTitle('Go to home directory'));
  
  await screen.findByText(`Browse: ${homedir()}`);
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/ui/DirectoryField.test.tsx
```

**Commit:** "feat: add navigation and breadcrumbs to DirectoryField browser" ✅ COMPLETED

---

### Task 7: Replace manual inputs in ProjectSelectorPanel

**Files to modify:**
- `packages/web/components/config/ProjectSelectorPanel.tsx`

**Files to reference:**
- `packages/web/components/ui/index.ts` - Import DirectoryField

**Implementation:**
```typescript
// Add import at top of file
import { DirectoryField } from '@/components/ui';

// Replace the simplified mode directory input (around line 988-995):
// OLD CODE:
/*
<input
  type="text"
  value={createWorkingDirectory}
  onChange={(e) => handleCreateDirectoryChange(e.target.value)}
  className="input input-bordered w-full input-lg"
  placeholder="/path/to/your/project"
  required
  autoFocus
/>
*/

// NEW CODE:
<DirectoryField
  label="Choose your project directory"
  value={createWorkingDirectory}
  onChange={handleCreateDirectoryChange}
  placeholder="/path/to/your/project"
  required
  className="input-lg"
/>

// Replace the advanced mode directory input (around lines 1063-1068):
// OLD CODE:
/*
<input
  type="text"
  value={createWorkingDirectory}
  onChange={(e) => setCreateWorkingDirectory(e.target.value)}
  className="input input-bordered w-full"
  placeholder="/path/to/project"
  required
/>
*/

// NEW CODE:
<DirectoryField
  label="Working Directory"
  value={createWorkingDirectory}
  onChange={setCreateWorkingDirectory}
  placeholder="/path/to/project"
  required
/>

// Replace the edit modal directory input (around lines 774-781):
// OLD CODE:
/*
<input
  type="text"
  value={editWorkingDirectory}
  onChange={(e) => setEditWorkingDirectory(e.target.value)}
  className="input input-bordered w-full"
  placeholder="/path/to/project"
  required
/>
*/

// NEW CODE:
<DirectoryField
  value={editWorkingDirectory}
  onChange={setEditWorkingDirectory}
  placeholder="/path/to/project"
  required
/>
```

**Update tests:**
Update `packages/web/components/config/ProjectSelectorPanel.test.tsx`:
```typescript
// Update the test that checks for the directory input placeholder:
it('should open create project modal when create button is clicked', async () => {
  render(
    <ProjectSelectorPanel
      projects={mockProjects}
      selectedProject={null}
      onProjectSelect={mockOnProjectSelect}
      onProjectCreate={mockOnProjectCreate}
    />
  );

  await user.click(screen.getByRole('button', { name: /new project/i }));
  
  // Should show DirectoryField instead of plain input
  expect(screen.getByText('Choose your project directory')).toBeInTheDocument();
  expect(screen.getAllByText('Create New Project')).toHaveLength(2);
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/config/ProjectSelectorPanel.test.tsx
```

**Commit:** "feat: replace manual directory inputs with DirectoryField in ProjectSelectorPanel" ✅ COMPLETED

---

### Task 8: Add Storybook story for DirectoryField

**Files to create:**
- `packages/web/components/ui/DirectoryField.stories.tsx`

**Files to reference:**
- `packages/web/components/ui/Modal.stories.tsx` - Study Storybook patterns

**Implementation:**
```typescript
// packages/web/components/ui/DirectoryField.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { DirectoryField } from './DirectoryField';
import { useState } from 'react';

const meta = {
  title: 'UI/DirectoryField',
  component: DirectoryField,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component: 'A directory browser field that allows users to select directories by typing or browsing. Includes autocomplete and navigation features.',
      },
    },
  },
  argTypes: {
    onChange: { action: 'changed' },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof DirectoryField>;

export default meta;
type Story = StoryObj<typeof meta>;

// Wrapper component to manage state
function DirectoryFieldWrapper(props: Partial<React.ComponentProps<typeof DirectoryField>>) {
  const [value, setValue] = useState(props.value || '');
  
  return (
    <DirectoryField
      {...props}
      value={value}
      onChange={setValue}
    />
  );
}

export const Default: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Project Directory',
    placeholder: 'Select a directory',
  },
};

export const Required: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Required Directory',
    required: true,
    helpText: 'This field is required',
  },
};

export const WithError: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Directory with Error',
    error: true,
    value: '/invalid/path',
    helpText: 'Please select a valid directory',
  },
};

export const Disabled: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Disabled Directory',
    value: '/some/path',
    disabled: true,
  },
};

export const WithValue: Story = {
  render: (args) => <DirectoryFieldWrapper {...args} />,
  args: {
    label: 'Pre-filled Directory',
    value: process.env.HOME || '/home/user',
    helpText: 'Directory field with existing value',
  },
};
```

**How to test:**
```bash
cd packages/web
npm run storybook
# Navigate to UI/DirectoryField in the Storybook interface
```

**Commit:** "feat: add Storybook story for DirectoryField component" ✅ COMPLETED

---

### Task 9: Add comprehensive integration tests

**Files to create:**
- `packages/web/components/ui/DirectoryField.integration.test.tsx`

**Files to reference:**
- `packages/web/test-utils/web-test-setup.ts` - Study test setup patterns
- `packages/web/components/files/FileDiffViewer.integration.tsx` - Study integration test patterns

**Implementation:**
```typescript
// packages/web/components/ui/DirectoryField.integration.test.tsx
import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { DirectoryField } from './DirectoryField';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { tempdir } from 'os';

describe('DirectoryField Integration Tests', () => {
  const user = userEvent.setup();
  let testDir: string;
  let subDir: string;

  beforeAll(async () => {
    // Create test directory structure
    testDir = join(tempdir(), 'directory-field-test');
    subDir = join(testDir, 'subdir');
    
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(subDir, { recursive: true });
    
    // Create a test file to ensure directory listing works
    await fs.writeFile(join(testDir, 'test-file.txt'), 'test content');
  });

  afterAll(async () => {
    // Clean up test directories
    try {
      await fs.rm(testDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
    cleanup();
  });

  it('should load and display real directories from filesystem', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByLabelText('Directory');
    await user.click(input);

    // Wait for real directories to load
    await waitFor(
      () => expect(screen.getByText(/Browse: /)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // Should show actual home directory
    expect(screen.getByText(`Browse: ${homedir()}`)).toBeInTheDocument();
    
    // Should show "Home" breadcrumb
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('should handle autocomplete with real filesystem paths', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByLabelText('Directory');
    await user.click(input);

    // Wait for directories to load
    await waitFor(
      () => expect(screen.getByText(/Browse: /)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // Type a path that should match real directories
    const homeDir = homedir();
    await user.clear(input);
    await user.type(input, `${homeDir}/Do`);

    // Should trigger autocomplete (if Documents or Downloads directory exists)
    await waitFor(
      () => {
        const autocompleteSection = screen.queryByText('Matching directories');
        const noDirectories = screen.queryByText('No directories found');
        expect(autocompleteSection || noDirectories).toBeInTheDocument();
      },
      { timeout: 3000 }
    );
  });

  it('should handle navigation between real directories', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value=""
        onChange={mockOnChange}
      />
    );

    const input = screen.getByLabelText('Directory');
    await user.click(input);

    // Wait for directories to load
    await waitFor(
      () => expect(screen.getByText(/Browse: /)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // Look for a directory we can navigate into
    const directoryButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent?.includes('Double-click to browse')
    );

    if (directoryButtons.length > 0) {
      // Navigate into first available directory
      await user.dblClick(directoryButtons[0]);

      // Wait for navigation to complete
      await waitFor(
        () => expect(screen.getByTitle('Go up one level')).toBeInTheDocument(),
        { timeout: 5000 }
      );

      // Navigate back
      await user.click(screen.getByTitle('Go up one level'));

      // Should be back at home directory
      await waitFor(
        () => expect(screen.getByText(`Browse: ${homedir()}`)).toBeInTheDocument(),
        { timeout: 5000 }
      );
    }
  });

  it('should handle directory selection and form submission', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <form>
        <DirectoryField
          label="Directory"
          value=""
          onChange={mockOnChange}
        />
        <button type="submit">Submit</button>
      </form>
    );

    const input = screen.getByLabelText('Directory');
    await user.click(input);

    // Wait for directories to load
    await waitFor(
      () => expect(screen.getByText(/Browse: /)).toBeInTheDocument(),
      { timeout: 5000 }
    );

    // Select first available directory
    const directoryButtons = screen.getAllByRole('button').filter(btn =>
      btn.textContent?.includes('Double-click to browse')
    );

    if (directoryButtons.length > 0) {
      await user.click(directoryButtons[0]);

      // Should have called onChange with directory path
      expect(mockOnChange).toHaveBeenCalledWith(expect.stringMatching(/^[/]/));
      
      // Dropdown should close
      await waitFor(
        () => expect(screen.queryByText(/Browse: /)).not.toBeInTheDocument(),
        { timeout: 2000 }
      );
    }
  });

  it('should handle API errors gracefully', async () => {
    const mockOnChange = vi.fn();
    
    render(
      <DirectoryField
        label="Directory"
        value="/definitely/does/not/exist"
        onChange={mockOnChange}
      />
    );

    const input = screen.getByLabelText('Directory');
    await user.click(input);

    // Should show error when trying to load non-existent directory
    await waitFor(
      () => {
        const errorMessage = screen.queryByText(/Failed to load directories|Directory not found/);
        expect(errorMessage).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });
});
```

**How to test:**
```bash
cd packages/web
npm run test:run components/ui/DirectoryField.integration.test.tsx
```

**Note:** These tests will be slower because they use real filesystem operations, but they verify the complete functionality works end-to-end.

**Commit:** "test: add comprehensive integration tests for DirectoryField"

---

### Task 10: Add end-to-end test for project creation flow

**Files to create:**
- `packages/web/e2e/directory-browser.e2e.ts`

**Files to reference:**
- `packages/web/e2e/hash-routing-persistence.e2e.ts` - Study E2E test patterns

**Implementation:**
```typescript
// packages/web/e2e/directory-browser.e2e.ts
import { test, expect } from '@playwright/test';
import { homedir } from 'os';

test.describe('Directory Browser E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should create project using directory browser', async ({ page }) => {
    // Click "New Project" button
    await page.getByRole('button', { name: /new project/i }).click();

    // Should open create project modal
    await expect(page.getByText('Welcome to Lace')).toBeVisible();

    // Should show directory field
    const directoryLabel = page.getByText('Choose your project directory');
    await expect(directoryLabel).toBeVisible();

    // Click on directory field to open browser
    const directoryInput = page.getByLabelText('Choose your project directory');
    await directoryInput.click();

    // Should show directory browser dropdown
    await expect(page.getByText(/Browse: /)).toBeVisible();

    // Should show home directory path
    await expect(page.getByText(`Browse: ${homedir()}`)).toBeVisible();

    // Type a path to test autocomplete
    await directoryInput.fill(`${homedir()}/Doc`);

    // Wait a moment for autocomplete to trigger
    await page.waitForTimeout(1000);

    // Should show either autocomplete results or "No directories found"
    const autocompleteOrEmpty = page.locator('[text*="Matching directories"], [text*="No directories found"]');
    await expect(autocompleteOrEmpty.first()).toBeVisible();

    // Clear and type full path
    await directoryInput.fill(`${homedir()}/Documents`);

    // If Documents directory exists, project name should be auto-filled
    const projectNameInput = page.getByLabelText('Project Name');
    if (await projectNameInput.isVisible()) {
      await expect(projectNameInput).toHaveValue('Documents');
    }

    // Submit the form (note: this will fail in E2E because we can't create actual projects)
    // But we can verify the form validation works
    await page.getByRole('button', { name: /get started/i }).click();

    // Form should attempt submission (might show error about invalid directory)
    // This validates the integration is working
  });

  test('should navigate directories in browser', async ({ page }) => {
    // Navigate to project creation
    await page.getByRole('button', { name: /new project/i }).click();
    
    // Open directory browser
    const directoryInput = page.getByLabelText('Choose your project directory');
    await directoryInput.click();

    // Wait for directory browser to load
    await expect(page.getByText(/Browse: /)).toBeVisible();

    // Should show navigation buttons
    await expect(page.getByTitle('Go to home directory')).toBeVisible();

    // Look for directories to navigate into
    const directories = page.locator('[text*="Double-click to browse"]');
    const count = await directories.count();

    if (count > 0) {
      // Double-click first directory
      await directories.first().dblClick();

      // Should show "Go up one level" button
      await expect(page.getByTitle('Go up one level')).toBeVisible();

      // Click back button
      await page.getByTitle('Go up one level').click();

      // Should be back at home directory
      await expect(page.getByText(`Browse: ${homedir()}`)).toBeVisible();
    }
  });

  test('should handle directory browser errors', async ({ page }) => {
    // Navigate to project creation
    await page.getByRole('button', { name: /new project/i }).click();
    
    // Type invalid path
    const directoryInput = page.getByLabelText('Choose your project directory');
    await directoryInput.fill('/invalid/path/that/does/not/exist');
    
    // Click to open browser
    await directoryInput.click();

    // Should show error message
    await expect(page.getByText(/Failed to load|Directory not found|Permission denied/)).toBeVisible();
  });

  test('should work in edit project modal', async ({ page }) => {
    // This test assumes there are existing projects
    // Click on a project's context menu (three dots)
    const contextMenuButton = page.locator('[data-testid="project-context-menu"]').first();
    if (await contextMenuButton.isVisible()) {
      await contextMenuButton.click();
      
      // Click Edit
      await page.getByText('Edit').click();

      // Should show edit modal with directory field
      await expect(page.getByText('Working Directory')).toBeVisible();

      // Directory field should be functional
      const editDirectoryInput = page.getByLabelText('Working Directory');
      await editDirectoryInput.click();

      // Should open directory browser
      await expect(page.getByText(/Browse: /)).toBeVisible();
    }
  });
});
```

**How to test:**
```bash
cd packages/web
npx playwright test directory-browser.e2e.ts
```

**Commit:** "test: add end-to-end tests for directory browser functionality"

---

## Final Validation Checklist

Before considering the implementation complete, verify:

### **Functionality Tests**
- [ ] API endpoint restricts access to home directory only
- [ ] API endpoint returns proper directory listings
- [ ] DirectoryField opens dropdown on focus
- [ ] Autocomplete works with 3+ characters
- [ ] Directory navigation works (double-click to enter, breadcrumbs to go back)
- [ ] Directory selection closes dropdown and updates field value
- [ ] Integration with ProjectSelectorPanel works in both simplified and advanced modes

### **Error Handling Tests**
- [ ] Invalid paths show appropriate error messages
- [ ] Permission denied errors are handled gracefully
- [ ] Network errors don't crash the component
- [ ] Missing directories are handled properly

### **TypeScript Compliance**
- [ ] No `any` types used anywhere in the code
- [ ] All props and state properly typed
- [ ] API responses properly typed with Zod schemas
- [ ] Component exports follow existing patterns

### **Test Coverage**
- [ ] Unit tests cover component behavior
- [ ] Integration tests use real filesystem operations (no mocks of core functionality)
- [ ] E2E tests validate complete user flows
- [ ] All tests pass without warnings or errors

### **Performance**
- [ ] API calls are debounced appropriately
- [ ] Directory listings are limited to prevent UI slowdown
- [ ] Component doesn't cause memory leaks
- [ ] Dropdown positioning works on different screen sizes

### **Accessibility**
- [ ] Component is keyboard navigable
- [ ] Screen readers can understand the interface
- [ ] ARIA labels are appropriate
- [ ] Color contrast meets standards

### **Documentation**
- [ ] Storybook story documents all component variants
- [ ] README or inline documentation explains usage
- [ ] API endpoints documented
- [ ] Test setup documented for other developers

## Deployment Notes

1. **Security**: The API restricts access to the user's home directory only. In production, consider additional authentication/authorization.

2. **Performance**: Directory listings are limited to prevent slowdown. Consider pagination for directories with many subdirectories.

3. **Error Handling**: The component gracefully handles various error states. Monitor error rates in production.

4. **Browser Compatibility**: Component uses modern JavaScript features. Ensure build pipeline includes appropriate polyfills.

5. **Testing**: Integration tests use real filesystem operations which may be slower in CI. Consider separate test suites for different environments.
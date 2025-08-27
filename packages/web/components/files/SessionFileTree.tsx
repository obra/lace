// ABOUTME: Reusable component for displaying session file tree with expand/collapse functionality
// ABOUTME: Provides hierarchical file browsing with search filtering and lazy loading

'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFolder,
  faFolderOpen,
  faFile,
  faChevronRight,
  faChevronDown,
  faSpinner,
} from '@/lib/fontawesome';
import { api } from '@/lib/api-client';
import { formatFileSize } from '@/lib/format-file-size';
import type { SessionDirectoryResponse, SessionFileEntry } from '@/types/session-files';

interface FileTreeNode extends SessionFileEntry {
  children?: FileTreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

interface SessionFileTreeProps {
  sessionId: string;
  onFileSelect: (filePath: string, fileName: string) => void;
  searchTerm?: string;
  className?: string;
}

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onFileSelect: (filePath: string, fileName: string) => void;
  onDirectoryToggle: (path: string) => void;
  searchTerm?: string;
}

// File icon helper
function getFileIcon(
  fileName: string,
  isDirectory: boolean,
  isExpanded: boolean = false
): React.ReactNode {
  if (isDirectory) {
    return (
      <FontAwesomeIcon
        icon={isExpanded ? faFolderOpen : faFolder}
        className="w-4 h-4 text-blue-500"
      />
    );
  }

  // Simple file icon - could be enhanced with file type detection
  return <FontAwesomeIcon icon={faFile} className="w-4 h-4 text-base-content/60" />;
}

// Highlight search term in text
function highlightSearchTerm(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm || searchTerm.length < 2) return text;

  const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedTerm})`, 'i'); // Remove global flag
  const parts = text.split(regex);

  return parts.map((part, index) => {
    // Highlight odd-indexed parts (captured groups)
    if (index % 2 === 1) {
      return (
        <mark key={index} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
          {part}
        </mark>
      );
    }
    return part;
  });
}

function FileTreeItem({
  node,
  depth,
  onFileSelect,
  onDirectoryToggle,
  searchTerm,
}: FileTreeItemProps) {
  const handleClick = useCallback(() => {
    if (node.type === 'directory') {
      onDirectoryToggle(node.path);
    } else {
      onFileSelect(node.path, node.name);
    }
  }, [node.type, node.path, node.name, onDirectoryToggle, onFileSelect]);

  const shouldShowInSearch = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return true;
    // Check if this node or any loaded children match
    const nodeMatches = node.name.toLowerCase().includes(searchTerm.toLowerCase());
    if (nodeMatches) return true;
    
    // For directories, check if any loaded children match
    if (node.type === 'directory' && node.children) {
      return node.children.some(child => 
        child.name.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    return false;
  }, [node.name, node.type, node.children, searchTerm]);

  if (!shouldShowInSearch) return null;

  return (
    <>
      <div
        className={`
          flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-base-200 rounded
          transition-colors duration-150
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        role="treeitem"
        tabIndex={0}
        aria-expanded={node.type === 'directory' ? node.isExpanded : undefined}
        aria-selected={false}
      >
        {/* Expand/collapse indicator for directories */}
        {node.type === 'directory' && (
          <div className="w-4 h-4 flex items-center justify-center">
            {node.isLoading ? (
              <FontAwesomeIcon
                icon={faSpinner}
                className="w-3 h-3 animate-spin text-base-content/40"
              />
            ) : (
              <FontAwesomeIcon
                icon={node.isExpanded ? faChevronDown : faChevronRight}
                className="w-3 h-3 text-base-content/40"
              />
            )}
          </div>
        )}
        {node.type === 'file' && <div className="w-4" />}

        {/* File/folder icon */}
        {getFileIcon(node.name, node.type === 'directory', node.isExpanded)}

        {/* File/folder name */}
        <span className="text-sm truncate flex-1">
          {highlightSearchTerm(node.name, searchTerm || '')}
        </span>

        {/* File size for files */}
        {node.type === 'file' && typeof node.size === 'number' && (
          <span className="text-xs text-base-content/40">{formatFileSize(node.size)}</span>
        )}
      </div>

      {/* Render children if directory is expanded */}
      {node.type === 'directory' && node.isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              onDirectoryToggle={onDirectoryToggle}
              searchTerm={searchTerm}
            />
          ))}
        </div>
      )}
    </>
  );
}


export function SessionFileTree({
  sessionId,
  onFileSelect,
  searchTerm,
  className = '',
}: SessionFileTreeProps) {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Update tree node with loaded children
  const updateTreeNode = useCallback(
    (nodes: FileTreeNode[], targetPath: string, newEntries: SessionFileEntry[]): FileTreeNode[] => {
      return nodes.map((node) => {
        if (node.path === targetPath) {
          return {
            ...node,
            children: newEntries.map((entry) => ({
              ...entry,
              isExpanded: false,
              isLoading: false,
            })),
            isExpanded: true,
            isLoading: false,
          };
        } else if (node.children) {
          return {
            ...node,
            children: updateTreeNode(node.children, targetPath, newEntries),
          };
        }
        return node;
      });
    },
    []
  );

  // Load directory contents
  const loadDirectory = useCallback(
    async (path: string = '') => {
      try {
        setIsLoading(true);
        setError(null);

        const url = `/api/sessions/${sessionId}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`;
        const response = await api.get<SessionDirectoryResponse>(url);

        if (path === '') {
          // Loading root directory
          const rootNodes: FileTreeNode[] = response.entries.map((entry) => ({
            ...entry,
            isExpanded: false,
            isLoading: false,
          }));
          setFileTree(rootNodes);
          setHasLoaded(true);
        } else {
          // Loading subdirectory - update the tree
          setFileTree((prevTree) => updateTreeNode(prevTree, path, response.entries));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory');
        console.error('Failed to load directory:', err);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, updateTreeNode]
  );

  // Helper function to recursively toggle nodes
  const toggleTreeNode = useCallback(
    (nodes: FileTreeNode[], targetPath: string): FileTreeNode[] => {
      return nodes.map((node) => {
        if (node.path === targetPath) {
          if (node.isExpanded) {
            return { ...node, isExpanded: false };
          } else {
            const updatedNode = { ...node, isExpanded: true, isLoading: !node.children };
            if (!node.children) {
              void loadDirectory(targetPath);
            }
            return updatedNode;
          }
        } else if (node.children) {
          return {
            ...node,
            children: toggleTreeNode(node.children, targetPath),
          };
        }
        return node;
      });
    },
    [loadDirectory]
  );

  // Handle directory expand/collapse
  const handleDirectoryToggle = useCallback(
    (path: string) => {
      setFileTree((prevTree) => {
        return prevTree.map((node) => {
          if (node.path === path) {
            if (node.isExpanded) {
              // Collapse
              return { ...node, isExpanded: false };
            } else {
              // Expand - load children if not already loaded
              const updatedNode = { ...node, isExpanded: true, isLoading: !node.children };
              if (!node.children) {
                // Load directory contents
                void loadDirectory(path);
              }
              return updatedNode;
            }
          } else if (node.children) {
            return {
              ...node,
              children: toggleTreeNode(node.children, path),
            };
          }
          return node;
        });
      });
    },
    [loadDirectory, toggleTreeNode]
  );

  // Load root directory on mount
  React.useEffect(() => {
    if (!hasLoaded) {
      void loadDirectory();
    }
  }, [loadDirectory, hasLoaded]);

  if (isLoading && !hasLoaded) {
    return (
      <div className={`flex items-center justify-center p-4 ${className}`}>
        <FontAwesomeIcon icon={faSpinner} className="w-4 h-4 animate-spin mr-2" />
        <span className="text-sm text-base-content/60">Loading files...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`p-4 text-center ${className}`}>
        <div className="text-sm text-red-600">{error}</div>
        <button
          onClick={() => loadDirectory()}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={`overflow-y-auto ${className}`} role="tree">
      {fileTree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          onFileSelect={onFileSelect}
          onDirectoryToggle={handleDirectoryToggle}
          searchTerm={searchTerm}
        />
      ))}
      {fileTree.length === 0 && hasLoaded && (
        <div className="p-4 text-center text-sm text-base-content/60">No files found</div>
      )}
    </div>
  );
}

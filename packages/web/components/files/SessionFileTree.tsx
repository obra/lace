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
  sessionId: string;
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
  return <FontAwesomeIcon icon={faFile} className="w-4 h-4 text-gray-500" />;
}

// Highlight search term in text
function highlightSearchTerm(text: string, searchTerm: string): React.ReactNode {
  if (!searchTerm || searchTerm.length < 2) return text;

  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark key={index} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function FileTreeItem({
  node,
  depth,
  sessionId,
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
    return node.name.toLowerCase().includes(searchTerm.toLowerCase());
  }, [node.name, searchTerm]);

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
      >
        {/* Expand/collapse indicator for directories */}
        {node.type === 'directory' && (
          <div className="w-4 h-4 flex items-center justify-center">
            {node.isLoading ? (
              <FontAwesomeIcon icon={faSpinner} className="w-3 h-3 animate-spin text-gray-400" />
            ) : (
              <FontAwesomeIcon
                icon={node.isExpanded ? faChevronDown : faChevronRight}
                className="w-3 h-3 text-gray-400"
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
        {node.type === 'file' && node.size && (
          <span className="text-xs text-gray-400">{formatFileSize(node.size)}</span>
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
              sessionId={sessionId}
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

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
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
        <span className="text-sm text-gray-600">Loading files...</span>
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
    <div className={`overflow-y-auto ${className}`}>
      {fileTree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          sessionId={sessionId}
          onFileSelect={onFileSelect}
          onDirectoryToggle={handleDirectoryToggle}
          searchTerm={searchTerm}
        />
      ))}
      {fileTree.length === 0 && hasLoaded && (
        <div className="p-4 text-center text-sm text-gray-500">No files found</div>
      )}
    </div>
  );
}

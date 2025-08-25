// ABOUTME: File browser sidebar section component integrating file tree with search
// ABOUTME: Provides collapsible sidebar section for session-scoped file browsing and viewing

'use client';

import React, { useState, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faSearch } from '@/lib/fontawesome';
import { SidebarSection } from '@/components/layout/Sidebar';
import { AccentInput } from '@/components/ui/AccentInput';
import { SessionFileTree } from '@/components/files/SessionFileTree';
import { FileViewerModal } from '@/components/modals/FileViewerModal';

interface FileBrowserSectionProps {
  sessionId: string;
  workingDirectory?: string;
  defaultCollapsed?: boolean;
  className?: string;
}

export function FileBrowserSection({
  sessionId,
  workingDirectory,
  defaultCollapsed = false,
  className = '',
}: FileBrowserSectionProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFile, setSelectedFile] = useState<{
    path: string;
    name: string;
  } | null>(null);

  const handleFileSelect = useCallback((filePath: string, fileName: string) => {
    setSelectedFile({ path: filePath, name: fileName });
  }, []);

  const handleCloseFileViewer = useCallback(() => {
    setSelectedFile(null);
  }, []);

  const handleSearchChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(event.target.value);
  }, []);

  // Don't render if no working directory is configured
  if (!workingDirectory) {
    return null;
  }

  return (
    <>
      <SidebarSection
        title="Files"
        icon={faFolder}
        collapsible={true}
        defaultCollapsed={defaultCollapsed}
        headerActions={
          <div className="flex items-center gap-2">
            <span
              className="text-xs text-base-content/60 truncate max-w-32"
              title={workingDirectory}
            >
              {workingDirectory.split('/').pop() || workingDirectory}
            </span>
          </div>
        }
      >
        {/* Search input */}
        <div className="px-2 pb-3">
          <div className="relative">
            <AccentInput
              placeholder="Search files..."
              value={searchTerm}
              onChange={handleSearchChange}
              className="text-sm"
            />
            <FontAwesomeIcon
              icon={faSearch}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 w-3 h-3 text-base-content/40 pointer-events-none"
            />
          </div>
        </div>

        {/* File tree */}
        <div className="px-1">
          <SessionFileTree
            sessionId={sessionId}
            onFileSelect={handleFileSelect}
            searchTerm={searchTerm}
            className="max-h-64"
          />
        </div>
      </SidebarSection>

      {/* File viewer modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={true}
          onClose={handleCloseFileViewer}
          sessionId={sessionId}
          filePath={selectedFile.path}
          fileName={selectedFile.name}
        />
      )}
    </>
  );
}

'use client';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileCode, faPlus, faMinus } from '~/lib/fontawesome';

interface CodeChange {
  id: string;
  type: 'feature' | 'bugfix' | 'refactor' | 'maintenance' | 'docs';
  title: string;
  commitHash: string;
  files: {
    path: string;
    additions: number;
    deletions: number;
    impact: 'high' | 'medium' | 'low';
  }[];
  totalFiles: number;
  maxDisplayFiles?: number;
}

interface CarouselCodeChangesProps {
  changes: CodeChange[];
}

export function CarouselCodeChanges({ changes }: CarouselCodeChangesProps) {
  const getTypeColor = (type: CodeChange['type']) => {
    switch (type) {
      case 'feature': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'bugfix': return 'bg-red-100 text-red-800 border-red-200';
      case 'refactor': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'maintenance': return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'docs': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-base-100 text-base-content border-base-300';
    }
  };

  const getImpactColor = (impact: 'high' | 'medium' | 'low') => {
    switch (impact) {
      case 'high': return 'bg-red-500';
      case 'medium': return 'bg-yellow-500';
      case 'low': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  const getFileIcon = (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        return '📄';
      case 'css':
      case 'scss':
        return '🎨';
      case 'json':
        return '⚙️';
      case 'md':
        return '📝';
      default:
        return '📄';
    }
  };

  return (
    <div className="space-y-4">
      {changes.map((change) => {
        const maxDisplay = change.maxDisplayFiles || 3;
        const displayFiles = change.files.slice(0, maxDisplay);
        const remainingCount = change.totalFiles - maxDisplay;

        return (
          <div
            key={change.id}
            className="bg-base-100 border border-base-300 rounded-lg p-4 space-y-3"
          >
            {/* Header with type and commit */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs font-medium rounded border ${getTypeColor(change.type)}`}>
                  {change.type}
                </span>
                <span className="text-sm font-medium text-base-content">
                  {change.title}
                </span>
              </div>
              <span className="text-xs text-base-content/60 font-mono">
                {change.commitHash}
              </span>
            </div>

            {/* File list */}
            <div className="space-y-2">
              {displayFiles.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-base-200 rounded text-sm"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-lg">{getFileIcon(file.path)}</span>
                    <span className="font-mono text-xs text-base-content truncate">
                      {file.path}
                    </span>
                    <div className={`w-2 h-2 rounded-full ${getImpactColor(file.impact)}`} 
                         title={`${file.impact} impact`} />
                  </div>
                  
                  <div className="flex items-center gap-2 text-xs">
                    {file.additions > 0 && (
                      <span className="flex items-center gap-1 text-green-600">
                        <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
                        {file.additions}
                      </span>
                    )}
                    {file.deletions > 0 && (
                      <span className="flex items-center gap-1 text-red-600">
                        <FontAwesomeIcon icon={faMinus} className="w-3 h-3" />
                        {file.deletions}
                      </span>
                    )}
                  </div>
                </div>
              ))}

              {/* Show remaining files count */}
              {remainingCount > 0 && (
                <div className="text-center text-sm text-base-content/60 py-2">
                  + {remainingCount} more file{remainingCount !== 1 ? 's' : ''}...
                </div>
              )}
            </div>

            {/* Impact summary */}
            <div className="flex items-center justify-between pt-2 border-t border-base-300">
              <div className="flex items-center gap-2">
                <span className="text-xs text-base-content/60">Impact:</span>
                <div className="flex gap-1">
                  {change.files.map((file, index) => (
                    <div
                      key={index}
                      className={`w-2 h-2 rounded-full ${getImpactColor(file.impact)}`}
                    />
                  ))}
                </div>
              </div>
              
              <div className="text-xs text-base-content/60">
                {change.totalFiles} file{change.totalFiles !== 1 ? 's' : ''} changed
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
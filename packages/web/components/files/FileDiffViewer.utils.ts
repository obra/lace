// ABOUTME: Utility functions for creating FileDiff objects from various diff formats
// ABOUTME: Includes parsers for unified diff format and simple before/after text comparison

import type { FileDiff, DiffChunk, DiffLine } from './FileDiffViewer';

/**
 * Creates a FileDiff from old and new text content
 * Uses a simple line-by-line comparison approach
 */
export function createFileDiffFromText(
  oldText: string,
  newText: string,
  filePath: string,
  language?: string
): FileDiff {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  
  // Simple line-by-line diff algorithm
  const diffLines: DiffLine[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    
    if (oldIndex >= oldLines.length) {
      // Only new lines remaining
      diffLines.push({
        type: 'added',
        newLineNumber: newIndex + 1,
        content: newLine
      });
      newIndex++;
    } else if (newIndex >= newLines.length) {
      // Only old lines remaining
      diffLines.push({
        type: 'removed',
        oldLineNumber: oldIndex + 1,
        content: oldLine
      });
      oldIndex++;
    } else if (oldLine === newLine) {
      // Lines are the same
      diffLines.push({
        type: 'unchanged',
        oldLineNumber: oldIndex + 1,
        newLineNumber: newIndex + 1,
        content: oldLine
      });
      oldIndex++;
      newIndex++;
    } else {
      // Lines are different - this is a simple approach
      // In a real implementation, you'd use a proper diff algorithm like Myers
      diffLines.push({
        type: 'removed',
        oldLineNumber: oldIndex + 1,
        content: oldLine
      });
      diffLines.push({
        type: 'added',
        newLineNumber: newIndex + 1,
        content: newLine
      });
      oldIndex++;
      newIndex++;
    }
  }
  
  // Create a single chunk containing all lines
  const chunk: DiffChunk = {
    oldStart: 1,
    oldCount: oldLines.length,
    newStart: 1,
    newCount: newLines.length,
    lines: diffLines
  };
  
  return {
    oldFilePath: filePath,
    newFilePath: filePath,
    oldContent: oldText,
    newContent: newText,
    chunks: [chunk],
    language,
    isBinary: false,
    isNew: false,
    isDeleted: false,
    isRenamed: false
  };
}

/**
 * Creates a FileDiff for a newly created file
 */
export function createNewFileDiff(
  content: string,
  filePath: string,
  language?: string
): FileDiff {
  const lines = content.split('\n');
  const diffLines: DiffLine[] = lines.map((line, index) => ({
    type: 'added' as const,
    newLineNumber: index + 1,
    content: line
  }));
  
  const chunk: DiffChunk = {
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: lines.length,
    lines: diffLines
  };
  
  return {
    oldFilePath: '/dev/null',
    newFilePath: filePath,
    newContent: content,
    chunks: [chunk],
    language,
    isBinary: false,
    isNew: true,
    isDeleted: false,
    isRenamed: false
  };
}

/**
 * Creates a FileDiff for a deleted file
 */
export function createDeletedFileDiff(
  content: string,
  filePath: string,
  language?: string
): FileDiff {
  const lines = content.split('\n');
  const diffLines: DiffLine[] = lines.map((line, index) => ({
    type: 'removed' as const,
    oldLineNumber: index + 1,
    content: line
  }));
  
  const chunk: DiffChunk = {
    oldStart: 1,
    oldCount: lines.length,
    newStart: 0,
    newCount: 0,
    lines: diffLines
  };
  
  return {
    oldFilePath: filePath,
    newFilePath: '/dev/null',
    oldContent: content,
    chunks: [chunk],
    language,
    isBinary: false,
    isNew: false,
    isDeleted: true,
    isRenamed: false
  };
}

/**
 * Creates a FileDiff for a binary file
 */
export function createBinaryFileDiff(
  oldFilePath: string,
  newFilePath: string,
  isRenamed = false
): FileDiff {
  return {
    oldFilePath,
    newFilePath,
    chunks: [],
    isBinary: true,
    isNew: false,
    isDeleted: false,
    isRenamed
  };
}

/**
 * Parses a unified diff format string into a FileDiff object
 * This is a simplified parser - a production implementation would be more robust
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  const diffs: FileDiff[] = [];
  const lines = diffText.split('\n');
  
  let currentDiff: Partial<FileDiff> | null = null;
  let currentChunk: Partial<DiffChunk> | null = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // File header (--- a/file.txt)
    if (line.startsWith('--- ')) {
      if (currentDiff && currentChunk) {
        currentDiff.chunks = currentDiff.chunks || [];
        currentDiff.chunks.push(currentChunk as DiffChunk);
      }
      if (currentDiff) {
        diffs.push(currentDiff as FileDiff);
      }
      
      currentDiff = {
        oldFilePath: line.substring(4),
        chunks: [],
        isBinary: false,
        isNew: false,
        isDeleted: false,
        isRenamed: false
      };
      currentChunk = null;
    }
    
    // New file header (+++ b/file.txt)
    else if (line.startsWith('+++ ') && currentDiff) {
      currentDiff.newFilePath = line.substring(4);
    }
    
    // Chunk header (@@ -1,4 +1,4 @@)
    else if (line.startsWith('@@') && currentDiff) {
      if (currentChunk) {
        currentDiff.chunks = currentDiff.chunks || [];
        currentDiff.chunks.push(currentChunk as DiffChunk);
      }
      
      const match = line.match(/@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
      if (match) {
        currentChunk = {
          oldStart: parseInt(match[1]),
          oldCount: parseInt(match[2] || '1'),
          newStart: parseInt(match[3]),
          newCount: parseInt(match[4] || '1'),
          lines: []
        };
      }
    }
    
    // Diff content lines
    else if (currentChunk && (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))) {
      const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'unchanged';
      const content = line.substring(1);
      
      currentChunk.lines = currentChunk.lines || [];
      currentChunk.lines.push({
        type,
        content,
        // Line numbers would need to be calculated properly in a real implementation
        ...(type !== 'added' && { oldLineNumber: currentChunk.lines.length + (currentChunk.oldStart || 0) }),
        ...(type !== 'removed' && { newLineNumber: currentChunk.lines.length + (currentChunk.newStart || 0) })
      });
    }
  }
  
  // Add final diff and chunk
  if (currentDiff && currentChunk) {
    currentDiff.chunks = currentDiff.chunks || [];
    currentDiff.chunks.push(currentChunk as DiffChunk);
  }
  if (currentDiff) {
    diffs.push(currentDiff as FileDiff);
  }
  
  return diffs;
}

/**
 * Detects the programming language from a file path
 */
export function detectLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'cpp': 'cpp',
    'c': 'c',
    'h': 'c',
    'hpp': 'cpp',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'html': 'html',
    'xml': 'xml',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'md': 'markdown',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'bash',
    'ps1': 'powershell',
    'sql': 'sql',
    'go': 'go',
    'rs': 'rust',
    'php': 'php',
    'rb': 'ruby',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'clj': 'clojure',
    'r': 'r',
    'dart': 'dart',
    'vue': 'vue',
    'svelte': 'svelte',
    'dockerfile': 'dockerfile'
  };
  
  return ext ? languageMap[ext] : undefined;
}
// ABOUTME: Utility functions for creating FileDiff objects from various diff formats
// ABOUTME: Includes parsers for unified diff format and simple before/after text comparison

import type { FileDiff, DiffChunk, DiffLine } from './FileDiffViewer';

/**
 * Creates a FileDiff from old and new text content
 * Uses an improved diff algorithm with better line matching
 */
export function createFileDiffFromText(
  oldText: string,
  newText: string,
  filePath: string,
  language?: string
): FileDiff {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Use a proper diff algorithm for better results
  const diffLines = computeLineDiff(oldLines, newLines);

  // Create a single chunk containing all lines
  const chunk: DiffChunk = {
    oldStart: 1,
    oldCount: oldLines.length,
    newStart: 1,
    newCount: newLines.length,
    lines: diffLines,
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
    isRenamed: false,
  };
}

/**
 * Improved diff algorithm that produces cleaner diffs
 * Uses longest common subsequence approach for better line matching
 * Automatically folds sections with 4+ consecutive unchanged lines
 */
function computeLineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const allDiffLines: DiffLine[] = [];

  // Build a map of common lines for better matching
  const oldLineMap = new Map<string, number[]>();
  const newLineMap = new Map<string, number[]>();

  oldLines.forEach((line, index) => {
    if (!oldLineMap.has(line)) oldLineMap.set(line, []);
    oldLineMap.get(line)!.push(index);
  });

  newLines.forEach((line, index) => {
    if (!newLineMap.has(line)) newLineMap.set(line, []);
    newLineMap.get(line)!.push(index);
  });

  // Use a simplified LCS-based approach
  let oldIndex = 0;
  let newIndex = 0;
  let oldLineNum = 1;
  let newLineNum = 1;

  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];

    if (oldLine === newLine) {
      // Lines match exactly
      allDiffLines.push({
        type: 'unchanged',
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
        content: oldLine,
      });
      oldIndex++;
      newIndex++;
      oldLineNum++;
      newLineNum++;
    } else {
      // Lines don't match - look for the next common line
      let foundCommon = false;

      // Look ahead a bit to find next matching lines
      for (let lookAhead = 1; lookAhead <= 5 && !foundCommon; lookAhead++) {
        // Check if old[oldIndex] matches new[newIndex + lookAhead]
        if (newIndex + lookAhead < newLines.length && oldLine === newLines[newIndex + lookAhead]) {
          // Add the intermediate new lines as additions
          for (let i = 0; i < lookAhead; i++) {
            allDiffLines.push({
              type: 'added',
              newLineNumber: newLineNum,
              content: newLines[newIndex + i],
            });
            newLineNum++;
          }
          newIndex += lookAhead;
          foundCommon = true;
        }
        // Check if new[newIndex] matches old[oldIndex + lookAhead]
        else if (
          oldIndex + lookAhead < oldLines.length &&
          newLine === oldLines[oldIndex + lookAhead]
        ) {
          // Add the intermediate old lines as removals
          for (let i = 0; i < lookAhead; i++) {
            allDiffLines.push({
              type: 'removed',
              oldLineNumber: oldLineNum,
              content: oldLines[oldIndex + i],
            });
            oldLineNum++;
          }
          oldIndex += lookAhead;
          foundCommon = true;
        }
      }

      if (!foundCommon) {
        // No common line found nearby - treat as replacement
        allDiffLines.push({
          type: 'removed',
          oldLineNumber: oldLineNum,
          content: oldLine,
        });
        allDiffLines.push({
          type: 'added',
          newLineNumber: newLineNum,
          content: newLine,
        });
        oldIndex++;
        newIndex++;
        oldLineNum++;
        newLineNum++;
      }
    }
  }

  // Handle remaining lines
  while (oldIndex < oldLines.length) {
    allDiffLines.push({
      type: 'removed',
      oldLineNumber: oldLineNum,
      content: oldLines[oldIndex],
    });
    oldIndex++;
    oldLineNum++;
  }

  while (newIndex < newLines.length) {
    allDiffLines.push({
      type: 'added',
      newLineNumber: newLineNum,
      content: newLines[newIndex],
    });
    newIndex++;
    newLineNum++;
  }

  // Apply automatic folding to collapse large unchanged sections
  return applyAutoFolding(allDiffLines);
}

/**
 * Automatically folds sections with 4+ consecutive unchanged lines
 * Keeps the first and last line of each large unchanged section for context
 */
function applyAutoFolding(diffLines: DiffLine[], foldThreshold: number = 4): DiffLine[] {
  const foldedLines: DiffLine[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (line.type === 'unchanged') {
      // Count consecutive unchanged lines
      let unchangedCount = 0;
      let j = i;

      while (j < diffLines.length && diffLines[j].type === 'unchanged') {
        unchangedCount++;
        j++;
      }

      if (unchangedCount >= foldThreshold) {
        // Large section of unchanged lines - fold it
        // Keep first line for context
        foldedLines.push(diffLines[i]);

        // Add fold marker
        const skippedCount = unchangedCount - 2; // -2 because we show first and last

        foldedLines.push({
          type: 'unchanged',
          oldLineNumber: undefined,
          newLineNumber: undefined,
          content: `@@ ... ${skippedCount} unchanged lines skipped ... @@`,
          isFolded: true,
        });

        // Keep last line for context
        foldedLines.push(diffLines[i + unchangedCount - 1]);

        i += unchangedCount;
      } else {
        // Small section - keep all unchanged lines
        for (let k = 0; k < unchangedCount; k++) {
          foldedLines.push(diffLines[i + k]);
        }
        i += unchangedCount;
      }
    } else {
      // Changed line - always keep
      foldedLines.push(line);
      i++;
    }
  }

  return foldedLines;
}

/**
 * Creates a FileDiff for a newly created file
 */
export function createNewFileDiff(content: string, filePath: string, language?: string): FileDiff {
  const lines = content.split('\n');
  const diffLines: DiffLine[] = lines.map((line, index) => ({
    type: 'added' as const,
    newLineNumber: index + 1,
    content: line,
  }));

  const chunk: DiffChunk = {
    oldStart: 0,
    oldCount: 0,
    newStart: 1,
    newCount: lines.length,
    lines: diffLines,
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
    isRenamed: false,
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
    content: line,
  }));

  const chunk: DiffChunk = {
    oldStart: 1,
    oldCount: lines.length,
    newStart: 0,
    newCount: 0,
    lines: diffLines,
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
    isRenamed: false,
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
    isRenamed,
  };
}

/**
 * Parses a unified diff format string into a FileDiff object
 * This is a simplified parser - a production implementation would be more robust
 */
function parseUnifiedDiff(diffText: string): FileDiff[] {
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
        isRenamed: false,
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
          lines: [],
        };
      }
    }

    // Diff content lines
    else if (
      currentChunk &&
      (line.startsWith('+') || line.startsWith('-') || line.startsWith(' '))
    ) {
      const type = line.startsWith('+') ? 'added' : line.startsWith('-') ? 'removed' : 'unchanged';
      const content = line.substring(1);

      currentChunk.lines = currentChunk.lines || [];
      currentChunk.lines.push({
        type,
        content,
        // Line numbers would need to be calculated properly in a real implementation
        ...(type !== 'added' && {
          oldLineNumber: currentChunk.lines.length + (currentChunk.oldStart || 0),
        }),
        ...(type !== 'removed' && {
          newLineNumber: currentChunk.lines.length + (currentChunk.newStart || 0),
        }),
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
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    h: 'c',
    hpp: 'cpp',
    css: 'css',
    scss: 'scss',
    sass: 'sass',
    less: 'less',
    html: 'html',
    xml: 'xml',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    fish: 'bash',
    ps1: 'powershell',
    sql: 'sql',
    go: 'go',
    rs: 'rust',
    php: 'php',
    rb: 'ruby',
    swift: 'swift',
    kt: 'kotlin',
    scala: 'scala',
    clj: 'clojure',
    r: 'r',
    dart: 'dart',
    vue: 'vue',
    svelte: 'svelte',
    dockerfile: 'dockerfile',
  };

  return ext ? languageMap[ext] : undefined;
}

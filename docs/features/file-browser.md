# File Browser Feature

## Overview

The File Browser feature allows users to browse, search, and view files within their session's working directory directly from the Lace web interface. The feature provides a familiar file explorer experience integrated into the sidebar, with support for syntax highlighting and pop-out viewing.

## Components

### FileBrowserSection
Located in the sidebar, provides the main file browsing interface:
- Collapsible section header
- Search input for filtering files
- File tree with expand/collapse functionality
- Displays session working directory name

### SessionFileTree  
Recursive tree component for displaying file hierarchy:
- Lazy loading of directory contents
- File type icons (folders, files)
- Search term highlighting
- Click to select files, double-click to expand directories

### FileViewerModal
Modal for viewing file content:
- Syntax highlighting via highlight.js
- File metadata display (type, size)
- Copy, download, and pop-out actions
- Support for text files up to 1MB

### Standalone File Viewer
Chromeless window for dedicated file viewing:
- Full-screen file content display
- Same actions as modal viewer
- Accessible via `/file-viewer?session=X&file=Y`

## API Endpoints

### GET /api/sessions/[sessionId]/files
Lists files and directories in session's working directory
- Query parameter: `path` (optional, defaults to root)
- Returns: Array of file entries with metadata
- Security: Prevents path traversal outside working directory

### GET /api/sessions/[sessionId]/files/[...path]
Retrieves content of a specific file
- Path parameters: Session ID and file path segments
- Returns: File content with metadata and MIME type
- Limits: 1MB max file size, text files only
- Security: Path validation and access control

## Security Model

### Session Isolation
- All file operations are scoped to the session's `workingDirectory`
- Path traversal attacks (e.g., `../../../etc/passwd`) are prevented
- Each session can only access its own files

### File Access Controls
- Only readable files are displayed
- File permissions are checked before serving content
- Binary files are rejected with appropriate error messages
- Large files (>1MB) are rejected to prevent memory issues

### Content Sanitization
- All file content is sanitized through DOMPurify
- Syntax highlighting is applied safely to prevent XSS
- File names and paths are properly escaped

## Usage

### Basic File Browsing
1. Open a session in Lace
2. Ensure session has a working directory configured
3. "Files" section appears in sidebar
4. Click files to view content
5. Click directories to expand/collapse

### File Search
1. Type in the search box within the Files section
2. File tree automatically filters to matching names
3. Search is case-insensitive partial matching
4. Clear search to show all files

### File Viewing
1. Click any file in the tree
2. File Viewer modal opens with content
3. Syntax highlighting applied automatically
4. Use Copy button to copy content to clipboard
5. Use Download button to download file
6. Use pop-out button to open in dedicated window

### Pop-out Window
1. Click pop-out button in File Viewer modal
2. New chromeless window opens with file content
3. Window is resizable and scrollable
4. Same actions available as in modal

## Configuration

### Session Setup
The file browser requires a session with a configured `workingDirectory`:

```typescript
const sessionConfig: SessionConfiguration = {
  workingDirectory: '/path/to/project',
  // ... other config
};
```

### File Type Support
All text files up to 1MB are supported for viewing. Syntax highlighting is provided by highlight.js auto-detection, which supports 190+ languages including:
- JavaScript/TypeScript, Python, Java, Go, Rust, C/C++
- HTML, CSS, JSON, YAML, Markdown, SQL
- And many more - highlight.js automatically detects the language

## Testing

### Unit Tests
```bash
npm run test:run components/files/SessionFileTree.test.tsx
npm run test:run components/modals/FileViewerModal.test.tsx  
npm run test:run components/sidebar/FileBrowserSection.test.tsx
```

### API Tests
```bash
npm run test:run app/api/sessions/[sessionId]/files/route.test.ts
npm run test:run app/api/sessions/[sessionId]/files/[...path]/route.test.ts
```

### End-to-End Tests
```bash
npx playwright test file-browser.e2e.ts
```

## Future Enhancements

### Planned Features
- File editing capabilities
- Image preview for supported formats
- PDF viewing
- File upload/creation
- Git integration (show file status)
- Minimap for large files

### Performance Optimizations
- Virtual scrolling for large directories
- File content caching
- Debounced search
- Progressive loading of large files

## Troubleshooting

### Common Issues

**Files section not visible**
- Verify session has `workingDirectory` configured
- Check file permissions on working directory

**"Permission denied" errors**
- Verify Lace has read access to working directory
- Check that files are not locked by other processes

**"File too large" errors**
- Current limit is 1MB for text files
- Use download functionality for larger files

**Syntax highlighting not working**
- Check browser console for highlight.js errors
- Ensure highlight.js theme CSS is loaded
- Verify file contains text content (not binary)

### Debugging

Enable debug logging:
```bash
LACE_LOG_LEVEL=debug npm run dev
```

Check browser console for client-side errors and network requests to file API endpoints.
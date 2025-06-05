// File Browser Component for Lace Web Companion
// Displays project directory tree, file content with syntax highlighting, and git status

const { useState, useEffect, useRef } = React;

function FileBrowser({ socket, currentSession }) {
  const [currentPath, setCurrentPath] = useState('');
  const [directoryTree, setDirectoryTree] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [gitStatus, setGitStatus] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [viewMode, setViewMode] = useState('tree'); // 'tree', 'search', 'diff'
  const codeRef = useRef(null);

  // Initialize file browser
  useEffect(() => {
    fetchProjectRoot();
    fetchGitStatus();
  }, []);

  // Apply syntax highlighting when file content changes
  useEffect(() => {
    if (fileContent && codeRef.current) {
      // Use highlight.js from CDN
      if (window.hljs) {
        window.hljs.highlightAll();
      }
    }
  }, [fileContent]);

  const fetchProjectRoot = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/files/tree');
      if (response.ok) {
        const data = await response.json();
        setDirectoryTree(data);
        setCurrentPath(data.path || '');
      }
    } catch (error) {
      console.error('Failed to fetch project root:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const response = await fetch('/api/git/status');
      if (response.ok) {
        const data = await response.json();
        setGitStatus(data);
      }
    } catch (error) {
      console.error('Failed to fetch git status:', error);
    }
  };

  const fetchFileContent = async (filePath) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        setFileContent(data);
        setSelectedFile(filePath);
      }
    } catch (error) {
      console.error('Failed to fetch file content:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchFileDiff = async (filePath) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/git/diff/${encodeURIComponent(filePath)}`);
      if (response.ok) {
        const data = await response.json();
        setFileContent({ ...fileContent, diff: data.diff });
      }
    } catch (error) {
      console.error('Failed to fetch file diff:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const searchFiles = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type: 'files' })
      });
      
      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results || []);
      }
    } catch (error) {
      console.error('Failed to search files:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getFileIcon = (fileName, isDirectory) => {
    if (isDirectory) return '📁';
    
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return '⚡';
      case 'ts': case 'tsx': return '🔷';
      case 'py': return '🐍';
      case 'json': return '📋';
      case 'md': return '📖';
      case 'html': return '🌐';
      case 'css': return '🎨';
      case 'jpg': case 'png': case 'gif': return '🖼️';
      case 'pdf': return '📄';
      case 'zip': case 'tar': case 'gz': return '📦';
      default: return '📄';
    }
  };

  const getLanguageFromExtension = (fileName) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'js': case 'jsx': return 'javascript';
      case 'ts': case 'tsx': return 'typescript';
      case 'py': return 'python';
      case 'json': return 'json';
      case 'md': return 'markdown';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'sh': return 'bash';
      case 'sql': return 'sql';
      case 'xml': return 'xml';
      case 'yaml': case 'yml': return 'yaml';
      default: return 'plaintext';
    }
  };

  const getGitStatusIcon = (filePath) => {
    if (!gitStatus.files) return null;
    
    const fileStatus = gitStatus.files[filePath];
    if (!fileStatus) return null;
    
    switch (fileStatus) {
      case 'modified': return '🟡';
      case 'added': return '🟢';
      case 'deleted': return '🔴';
      case 'untracked': return '❓';
      case 'staged': return '✅';
      default: return null;
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const getBreadcrumbs = (path) => {
    if (!path) return [];
    const parts = path.split('/').filter(Boolean);
    return parts.map((part, index) => ({
      name: part,
      path: '/' + parts.slice(0, index + 1).join('/')
    }));
  };

  const renderDirectoryTree = (node, level = 0) => {
    if (!node) return null;

    return React.createElement('div', { key: node.path },
      React.createElement('div', {
        className: `file-item ${selectedFile === node.path ? 'selected' : ''}`,
        style: { paddingLeft: `${level * 1.5}rem` },
        onClick: () => {
          if (node.isDirectory) {
            // Toggle directory expansion could be implemented here
          } else {
            fetchFileContent(node.path);
          }
        }
      },
        React.createElement('span', { className: 'file-icon' }, getFileIcon(node.name, node.isDirectory)),
        React.createElement('span', { className: 'file-name' }, node.name),
        React.createElement('span', { className: 'file-size' }, 
          !node.isDirectory && formatFileSize(node.size)
        ),
        getGitStatusIcon(node.path) && React.createElement('span', { 
          className: 'git-status-icon' 
        }, getGitStatusIcon(node.path))
      ),
      
      // Render children if directory
      node.children && node.children.map(child => 
        renderDirectoryTree(child, level + 1)
      )
    );
  };

  return React.createElement('div', { className: 'file-browser' },
    // Header with breadcrumbs and controls
    React.createElement('div', { className: 'file-browser-header' },
      React.createElement('div', { className: 'breadcrumbs' },
        React.createElement('span', { className: 'breadcrumb-home' }, '🏠'),
        getBreadcrumbs(currentPath).map((crumb, index) =>
          React.createElement('span', { key: index, className: 'breadcrumb' },
            React.createElement('span', { className: 'breadcrumb-separator' }, '/'),
            React.createElement('span', { 
              className: 'breadcrumb-item',
              onClick: () => setCurrentPath(crumb.path)
            }, crumb.name)
          )
        )
      ),
      
      React.createElement('div', { className: 'file-browser-controls' },
        React.createElement('input', {
          type: 'text',
          placeholder: 'Search files...',
          value: searchQuery,
          onChange: (e) => {
            setSearchQuery(e.target.value);
            searchFiles(e.target.value);
          },
          className: 'search-input'
        }),
        React.createElement('select', {
          value: viewMode,
          onChange: (e) => setViewMode(e.target.value),
          className: 'view-mode-select'
        },
          React.createElement('option', { value: 'tree' }, 'Tree View'),
          React.createElement('option', { value: 'search' }, 'Search Results'),
          React.createElement('option', { value: 'diff' }, 'Git Diff')
        )
      )
    ),

    // Main content area
    React.createElement('div', { className: 'file-browser-content' },
      // Left sidebar - file tree or search results
      React.createElement('div', { className: 'file-tree-panel' },
        React.createElement('div', { className: 'panel-header' },
          React.createElement('h3', null, 
            viewMode === 'search' ? 'Search Results' :
            viewMode === 'diff' ? 'Modified Files' : 'Project Files'
          ),
          gitStatus.branch && React.createElement('div', { className: 'git-branch' },
            React.createElement('span', null, '🌿 '), gitStatus.branch
          )
        ),

        React.createElement('div', { className: 'file-tree-container' },
          isLoading && React.createElement('div', { className: 'loading-indicator' },
            'Loading...'
          ),

          viewMode === 'tree' && directoryTree && 
            renderDirectoryTree(directoryTree),

          viewMode === 'search' && searchResults.length > 0 &&
            searchResults.map((result, index) =>
              React.createElement('div', {
                key: index,
                className: `search-result ${selectedFile === result.path ? 'selected' : ''}`,
                onClick: () => fetchFileContent(result.path)
              },
                React.createElement('span', { className: 'file-icon' }, 
                  getFileIcon(result.name, false)
                ),
                React.createElement('span', { className: 'file-name' }, result.name),
                React.createElement('div', { className: 'search-context' }, result.context)
              )
            ),

          viewMode === 'search' && searchQuery && searchResults.length === 0 && !isLoading &&
            React.createElement('div', { className: 'no-results' },
              React.createElement('p', null, 'No files found')
            ),

          viewMode === 'diff' && gitStatus.files && 
            Object.entries(gitStatus.files).map(([filePath, status]) =>
              React.createElement('div', {
                key: filePath,
                className: `modified-file ${selectedFile === filePath ? 'selected' : ''}`,
                onClick: () => {
                  fetchFileContent(filePath);
                  fetchFileDiff(filePath);
                }
              },
                React.createElement('span', { className: 'file-icon' }, 
                  getFileIcon(filePath.split('/').pop(), false)
                ),
                React.createElement('span', { className: 'file-name' }, 
                  filePath.split('/').pop()
                ),
                React.createElement('span', { className: 'git-status' }, status),
                React.createElement('span', { className: 'git-status-icon' }, 
                  getGitStatusIcon(filePath)
                )
              )
            )
        )
      ),

      // Right panel - file content
      React.createElement('div', { className: 'file-content-panel' },
        selectedFile ? React.createElement('div', { className: 'file-content' },
          React.createElement('div', { className: 'file-content-header' },
            React.createElement('h4', null, selectedFile.split('/').pop()),
            React.createElement('div', { className: 'file-meta' },
              fileContent && React.createElement('span', null, 
                formatFileSize(fileContent.size), ' • ',
                getLanguageFromExtension(selectedFile)
              ),
              fileContent && fileContent.modified && React.createElement('span', null,
                ' • Modified: ', formatDate(fileContent.modified)
              )
            )
          ),

          fileContent && React.createElement('div', { className: 'file-content-body' },
            // Main content
            React.createElement('pre', { className: 'code-block' },
              React.createElement('code', { 
                ref: codeRef,
                className: `language-${getLanguageFromExtension(selectedFile)}`
              }, fileContent.content)
            ),

            // Diff view if available
            fileContent.diff && React.createElement('div', { className: 'diff-view' },
              React.createElement('h5', null, 'Git Diff'),
              React.createElement('pre', { className: 'diff-content' }, fileContent.diff)
            )
          )
        ) : React.createElement('div', { className: 'no-file-selected' },
          React.createElement('p', null, 'Select a file to view its contents'),
          React.createElement('div', { className: 'file-browser-tips' },
            React.createElement('h4', null, 'Tips:'),
            React.createElement('ul', null,
              React.createElement('li', null, 'Click on files in the tree to view content'),
              React.createElement('li', null, 'Use search to find files by name or content'),
              React.createElement('li', null, 'Switch to diff view to see git changes'),
              React.createElement('li', null, 'Files show git status indicators when modified')
            )
          )
        )
      )
    )
  );
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FileBrowser;
} else {
  window.FileBrowser = FileBrowser;
}
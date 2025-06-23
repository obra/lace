# URL Fetch Tool Design

## Overview

The URL Fetch tool enables fetching content from web URLs for research, documentation lookup, and web content analysis. This tool provides secure, controlled access to web resources with appropriate content handling and size management.

## Tool Interface

### Basic Configuration

```typescript
export class UrlFetchTool implements Tool {
  name = 'url_fetch';
  description = 'Fetch content from web URLs with intelligent content handling';
  annotations = {
    title: 'URL Fetcher',
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true, // Accesses external network resources
  };
}
```

### Input Schema

```typescript
input_schema = {
  type: 'object' as const,
  properties: {
    url: {
      type: 'string',
      description: 'URL to fetch (must be http:// or https://)',
      pattern: '^https?://.+'
    },
    method: {
      type: 'string',
      description: 'HTTP method (default: GET)',
      enum: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
      default: 'GET'
    },
    headers: {
      type: 'object',
      description: 'Custom HTTP headers',
      additionalProperties: { type: 'string' }
    },
    body: {
      type: 'string',
      description: 'Request body for POST/PUT requests'
    },
    timeout: {
      type: 'number',
      description: 'Request timeout in milliseconds (default: 30000, max: 120000)',
      minimum: 1000,
      maximum: 120000,
      default: 30000
    },
    maxSize: {
      type: 'number',
      description: 'Maximum response size in bytes (default: 33554432 = 32MB)',
      minimum: 1024,
      maximum: 104857600, // 100MB hard limit
      default: 33554432
    },
    followRedirects: {
      type: 'boolean',
      description: 'Follow HTTP redirects (default: true, max 10 redirects)',
      default: true
    }
  },
  required: ['url']
};
```

## Content Type Handling

### Automatic Content Detection

The tool automatically detects and handles content based on the `Content-Type` header:

#### Text Content Types
- **`text/plain`**: Raw text content
- **`text/html`**: HTML with optional content extraction
- **`text/css`**: CSS stylesheets
- **`text/javascript`**: JavaScript code
- **`text/markdown`**: Markdown content
- **`text/csv`**: CSV data
- **`text/xml`**: XML documents

#### Structured Data Types
- **`application/json`**: JSON with pretty-printing and validation
- **`application/xml`**: XML with formatting
- **`application/yaml`**: YAML content
- **`application/toml`**: TOML configuration

#### Document Types
- **`application/pdf`**: PDF metadata extraction (no content parsing)
- **`application/msword`**: Office document metadata
- **`application/vnd.openxmlformats-officedocument.*`**: Modern Office formats

#### Media Types
- **`image/*`**: Image metadata (dimensions, format, size)
- **`audio/*`**: Audio metadata (duration, format, bitrate)
- **`video/*`**: Video metadata (duration, resolution, format)

#### Archive Types
- **`application/zip`**: Archive contents listing
- **`application/gzip`**: Compressed file info
- **`application/x-tar`**: Tar archive contents

### Content Processing Pipeline

```typescript
interface ContentProcessor {
  canHandle(contentType: string): boolean;
  process(content: Buffer, metadata: ResponseMetadata): ProcessedContent;
}

interface ProcessedContent {
  type: 'text' | 'json' | 'html' | 'binary' | 'metadata';
  content: string;
  summary?: string;
  metadata?: Record<string, any>;
  truncated?: boolean;
  tempFilePath?: string;
}
```

## Large File Management

### Size Thresholds

- **32KB Inline Limit**: Content ≤ 32KB returned directly in response
- **32KB+ Temp Files**: Larger content written to temp files with preview
- **100MB Hard Limit**: Requests exceeding 100MB are rejected

### Large File Handling Process

1. **Stream Processing**: Content is streamed to detect size early
2. **Temp File Creation**: Files > 32KB written to `temp/url-fetch-{timestamp}-{hash}.{ext}`
3. **Preview Generation**: First 32KB returned as preview
4. **Metadata Extraction**: File info, content type, and access path provided

### Temp File Response Format

```typescript
interface LargeFileResponse {
  preview: string;           // First 32KB of content
  tempFilePath: string;      // Path to full content file
  totalSize: number;         // Total file size in bytes
  contentType: string;       // Detected content type
  encoding?: string;         // Character encoding if text
  truncated: true;           // Always true for temp files
  message: string;           // User-friendly explanation
}
```

Example response:
```json
{
  "preview": "<!DOCTYPE html>\n<html>\n<head>...",
  "tempFilePath": "temp/url-fetch-20231215-a1b2c3.html",
  "totalSize": 2048576,
  "contentType": "text/html",
  "encoding": "utf-8",
  "truncated": true,
  "message": "Large file (2.0MB) saved to temp/url-fetch-20231215-a1b2c3.html. Preview shows first 32KB."
}
```

## Security Implementation

### URL Validation
```typescript
function validateUrl(url: string): void {
  const parsedUrl = new URL(url);
  
  // Protocol validation
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }
  
  // Block private networks
  const hostname = parsedUrl.hostname;
  if (isPrivateNetwork(hostname)) {
    throw new Error('Access to private networks is not allowed');
  }
  
  // Block localhost variations
  if (isLocalhost(hostname)) {
    throw new Error('Access to localhost is not allowed');
  }
}

function isPrivateNetwork(hostname: string): boolean {
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  // 127.0.0.0/8, 169.254.0.0/16, ::1, fc00::/7
  // Implementation checks against private IP ranges
}
```

### Request Safety
- **Timeout Enforcement**: All requests have mandatory timeouts
- **Size Limits**: Streaming with early termination for oversized content
- **Redirect Limits**: Maximum 10 redirects to prevent loops
- **Header Sanitization**: Remove/validate dangerous headers
- **Content Validation**: Scan for malicious patterns in responses

### Content Sanitization
```typescript
function sanitizeHtmlContent(html: string): string {
  // Remove script tags, event handlers, and dangerous elements
  // Preserve structure while removing executable content
  return cleanHtml(html, {
    allowedTags: ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
                  'ul', 'ol', 'li', 'a', 'strong', 'em', 'code', 'pre'],
    allowedAttributes: {
      'a': ['href', 'title'],
      '*': ['class', 'id']
    }
  });
}
```

## Error Handling

### Error Categories
- **Network Errors**: DNS resolution, connection timeouts, refused connections
- **HTTP Errors**: 4xx/5xx status codes with meaningful messages
- **Content Errors**: Malformed data, encoding issues, content validation failures
- **Security Errors**: Blocked URLs, oversized content, malicious patterns
- **System Errors**: File system issues, memory limitations

### Error Response Format
```typescript
interface FetchError {
  type: 'network' | 'http' | 'content' | 'security' | 'system';
  message: string;
  details?: {
    statusCode?: number;
    headers?: Record<string, string>;
    url?: string;
    redirectChain?: string[];
  };
}
```

## Tool Registration

### Registration Code
```typescript
// src/tools/executor.ts
import { UrlFetchTool } from './implementations/url-fetch.js';

export class ToolExecutor {
  private registerAllAvailableTools(): void {
    const tools = [
      new BashTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new FileInsertTool(),
      new FileListTool(),
      new RipgrepSearchTool(),
      new FileFindTool(),
      new UrlFetchTool(), // Add here
    ];
    
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }
}
```

### CLI Integration
- **Default Policy**: Requires approval (due to `openWorldHint`)
- **Auto-approval**: Available with `--auto-approve-tools url_fetch`
- **Disable**: Can be disabled with `--disable-tools url_fetch`
- **Non-destructive**: Included in `--allow-non-destructive-tools`

## Usage Examples

### Basic Web Page Fetch
```json
{
  "tool": "url_fetch",
  "parameters": {
    "url": "https://example.com"
  }
}
```

### API Request with Authentication
```json
{
  "tool": "url_fetch",
  "parameters": {
    "url": "https://api.github.com/user/repos",
    "headers": {
      "Authorization": "Bearer ghp_xxxxxxxxxxxx",
      "Accept": "application/vnd.github.v3+json"
    }
  }
}
```

### POST Request with JSON Body
```json
{
  "tool": "url_fetch",
  "parameters": {
    "url": "https://api.example.com/search",
    "method": "POST",
    "headers": {
      "Content-Type": "application/json"
    },
    "body": "{\"query\": \"javascript frameworks\", \"limit\": 10}"
  }
}
```

### Large File Download
```json
{
  "tool": "url_fetch",
  "parameters": {
    "url": "https://example.com/large-dataset.json",
    "maxSize": 10485760
  }
}
```

## Testing Strategy

### Unit Tests
```typescript
// src/tools/__tests__/url-fetch.test.ts
describe('UrlFetchTool', () => {
  describe('URL validation', () => {
    it('should accept valid HTTP/HTTPS URLs');
    it('should reject non-HTTP protocols');
    it('should block private network access');
    it('should block localhost access');
  });
  
  describe('Content handling', () => {
    it('should handle JSON responses');
    it('should handle HTML content');
    it('should handle binary content');
    it('should create temp files for large content');
    it('should provide correct previews');
  });
  
  describe('Security', () => {
    it('should respect timeout limits');
    it('should enforce size limits');
    it('should limit redirects');
    it('should sanitize HTML content');
  });
  
  describe('Error handling', () => {
    it('should handle network errors');
    it('should handle HTTP errors');
    it('should handle malformed content');
  });
});
```

### Integration Tests
- Mock HTTP server for controlled testing
- Real URL tests with known stable endpoints
- Large file handling with test data
- Error scenario validation
- Security boundary testing

## Dependencies

### Core Dependencies
- **Node.js fetch**: Built-in HTTP client (Node 18+)
- **fs/promises**: File system operations for temp files
- **crypto**: Hash generation for temp file names
- **url**: URL parsing and validation

### Optional Enhancement Dependencies
- **cheerio**: HTML parsing and content extraction
- **mime-types**: Content type detection and handling
- **iconv-lite**: Character encoding conversion
- **file-type**: Binary file type detection

## Implementation Priority

### Phase 1: Core Functionality ✅ COMPLETE
- ✅ Basic URL fetching with security validation
- ✅ Content type detection and basic processing  
- ✅ Size limit enforcement with temp file creation
- ✅ Error handling and logging
- ✅ Process exit cleanup for temp files
- ✅ Tool registration with ToolExecutor
- ✅ Lynx-like HTML filtering and markdown conversion
- ✅ returnContent parameter for token limit control
- ✅ Comprehensive test suite (22 tests)

### Phase 2: Content Processing ✅ COMPLETE  
- ✅ HTML content extraction and sanitization (turndown with noise filtering)
- ✅ JSON parsing and pretty-printing
- ✅ Binary content metadata extraction
- ✅ Enhanced error messages with context

### Phase 3: Advanced Features ✅ COMPLETE (Rich Error Context)
- ✅ Rich error context system with full diagnostic information
- ✅ Request/response timing and redirect chain tracking  
- ✅ Structured error categorization (network, http, timeout, size, validation)
- ✅ Response headers and body preview for debugging
- ✅ Complete diagnostic data for agent decision-making
- ⚠️ Content streaming for better memory management (skipped - not priority)
- ⚠️ Caching mechanisms for repeated requests (skipped - not useful for coding agent)
- ⚠️ Rate limiting and request queuing (future enhancement)
- ⚠️ Advanced security scanning (future enhancement)

### Phase 4: Performance Optimization
- Connection pooling and reuse
- Compression support (gzip, brotli)
- Parallel request handling
- Memory usage optimization

## Success Criteria

1. **Security**: No access to private networks, localhost, or malicious content
2. **Reliability**: Graceful handling of network errors, timeouts, and edge cases
3. **Performance**: Efficient memory usage with large files and proper cleanup
4. **Usability**: Clear, structured responses with appropriate content formatting
5. **Integration**: Seamless operation within existing tool approval and policy systems
6. **Maintainability**: Clean, testable code with comprehensive error handling
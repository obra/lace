# Browser Console Forwarding for Next.js Development

This system forwards browser console messages (`console.log`, `console.error`, etc.) to your development server terminal for easier debugging during Next.js development.

## Inspiration

Inspired by [mitsuhiko/vite-console-forward-plugin](https://github.com/mitsuhiko/vite-console-forward-plugin) - a similar solution for Vite projects. We adapted the concept for Next.js using API routes and React components.

## How It Works

The system consists of three main components:

### 1. Client-Side Console Patching (`client.ts`)
- Patches browser console methods (`console.log`, `console.warn`, etc.) to capture all calls
- Uses SuperJSON for robust serialization including circular references and complex objects
- Buffers console messages and sends them in batches to reduce network overhead
- Fails gracefully if the server is unavailable

### 2. Server-Side API Route (`/app/api/debug/console/route.ts`)
- Receives batched console messages via POST requests
- Deserializes SuperJSON data back to readable objects
- Outputs messages to server terminal with colored formatting and timestamps
- Format: `[timestamp] [BROWSER] [LEVEL] path: message`

### 3. Automatic Integration (`script.tsx`)
- React component that automatically initializes console forwarding
- Only runs in development mode (`NODE_ENV === 'development'`)
- Injected into the app layout so it works across all pages

## Usage

The system is automatically active in development mode - no configuration needed!

### Basic Usage
```javascript
// In any React component or client-side code:
console.log('Hello from browser!', { data: 'test' });
console.error('Something went wrong', new Error('Details'));
console.warn('Warning message', [1, 2, 3]);
```

These messages will appear in your development server terminal like:
```
[2025-08-12T18:31:33.976Z] [BROWSER] [LOG] /: Hello from browser! {
  "data": "test"
}
[2025-08-12T18:31:34.123Z] [BROWSER] [ERROR] /: Something went wrong {
  "name": "Error",
  "message": "Details",
  "stack": "Error: Details\n    at ..."
}
```

### Complex Objects
The system handles complex objects, circular references, and special types:

```javascript
const complexObj = {
  date: new Date(),
  nested: { array: [1, 2, 3] },
  circular: null
};
complexObj.circular = complexObj; // Circular reference

console.log('Complex object:', complexObj);
// Output shows proper object structure with "[Circular Reference]" markers
```

## Configuration

Default configuration in `index.ts`:
```typescript
export const DEFAULT_CONFIG: ConsoleForwardConfig = {
  enabled: process.env.NODE_ENV === 'development', // Only in dev mode
  endpoint: '/api/debug/console',                  // API route endpoint
  levels: ['log', 'warn', 'error', 'info', 'debug'], // Console levels to forward
  bufferSize: 50,                                  // Max messages before flush
  flushInterval: 1000,                            // Auto-flush interval (ms)
};
```

## Architecture

```
Browser Console → Console Patching → SuperJSON Serialization → 
Batched HTTP Requests → Next.js API Route → Server Terminal Output
```

**Files:**
- `index.ts` - Types, interfaces, and configuration
- `client.ts` - Browser-side console patching and forwarding logic
- `script.tsx` - React component for automatic initialization
- `README.md` - This documentation

**Integration Points:**
- `app/layout.tsx` - Injects the console forwarding script
- `app/api/debug/console/route.ts` - Server-side API route handler

## Features

### ✅ Robust Serialization
- Uses SuperJSON to handle dates, undefined, BigInt, circular references
- Graceful fallbacks for unserializable objects
- Error objects are properly formatted with stack traces

### ✅ Performance Optimized
- Batches console calls to reduce network requests
- Configurable buffer size and flush intervals
- Fire-and-forget requests don't block console output

### ✅ Development Only
- Automatically disabled in production builds
- No performance impact on production code
- Clean conditional loading

### ✅ Full Console API Support
- `console.log`, `console.warn`, `console.error`
- `console.info`, `console.debug`
- Maintains original console functionality (still shows in browser DevTools)

### ✅ Rich Terminal Output
- Colored output by log level (red errors, yellow warnings, etc.)
- Timestamps and URL paths for context
- Pretty-printed JSON objects with proper indentation

## Testing

End-to-end tests verify the complete flow from browser console to server output:

```bash
npm run test:playwright console-forward.e2e.ts
```

Tests cover:
- Simple and complex object forwarding
- All console log levels
- Batching behavior
- Circular reference handling
- Development mode activation

## Troubleshooting

### Console messages not appearing in terminal?
1. Check that you're running in development mode (`NODE_ENV=development`)
2. Verify the dev server is running and accessible
3. Look for network errors in browser DevTools
4. Check that the API route `/api/debug/console` is accessible

### Performance concerns?
- The system only runs in development mode
- Messages are batched to minimize network requests
- Failed requests are silently ignored to avoid infinite loops

### Object serialization issues?
- SuperJSON handles most cases automatically
- Check server logs for `[CONSOLE-FORWARD]` error messages
- Unserializable objects fall back to string representation

## Benefits

**Before:**
- Switch between terminal and browser DevTools constantly
- Hard to correlate server logs with client behavior
- Complex objects show as `[object Object]` in many contexts

**After:**
- All console output appears in your development terminal
- Integrated view of both server and client logs
- Rich object formatting with full data visibility
- Streamlined debugging workflow
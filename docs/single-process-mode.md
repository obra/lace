# Single-Process Mode for Lace Web

## Overview

Lace Web now runs in single-process mode to ensure proper event propagation and state management for the single-user, multi-session architecture.

## Usage

### Basic Usage
```bash
npm run dev                    # Development mode on localhost:3000
npm run start                  # Production mode on localhost:3000
```

### Custom Port
```bash
npm run dev -- --port 8080     # Development on port 8080
npm run start -- --port 8080   # Production on port 8080
```

### Allow External Connections
```bash
npm run dev -- --host 0.0.0.0  # Allow connections from other devices
```

### Combined Options
```bash
npm run dev -- --port 8080 --host 0.0.0.0
```

## Architecture Benefits

1. **Event Propagation**: All agents exist in the same process, so EventEmitter events work correctly
2. **Shared State**: SessionService and SSEManager share memory properly
3. **No Duplication**: No risk of multiple processes spawning duplicate agents
4. **Simpler Debugging**: All logs come from single process

## Security Notes

- Default: Binds to `localhost` only (secure)
- Using `--host 0.0.0.0` allows external connections (use with caution)
- The server will warn you when binding to non-localhost addresses

## Process Management

The server runs as a single Node.js process. For production deployment:

```bash
# Using systemd
sudo systemctl start lace-web

# Using PM2 (single instance mode)
pm2 start server.ts --name lace-web --instances 1

# Docker
docker run -p 3000:3000 lace-web
```

## Performance Considerations

For a single-user system with ~12 concurrent sessions:
- CPU: Single core is sufficient for UI + agent operations
- Memory: More efficient than multi-process (no module duplication)
- Blocking: Agent operations are async and won't block the UI

## Migration from Next.js Default Server

The custom server (`server.ts`) replaces Next.js's default server to:
1. Guarantee single-process execution
2. Provide CLI options for port/host configuration
3. Add proper shutdown handling
4. Display helpful startup messages

The Next.js application behavior remains unchanged - only the server wrapper is different.
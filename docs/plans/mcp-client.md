# MCP Client Integration Specification

## Overview

This specification outlines the integration of Model Context Protocol (MCP) support into Lace, enabling users to configure and use MCP servers as external tool providers. The integration maintains Lace's existing tool system architecture while adding support for external MCP servers running in separate processes.

## Goals

- **Tool Support**: Enable MCP servers to provide tools that integrate seamlessly with Lace's existing tool system
- **Process Isolation**: MCP servers run as separate processes for reliability and security
- **Flexible Configuration**: Support global, project, and session-level configuration with granular control
- **Clean Architecture**: Extend existing systems without disrupting current functionality
- **Transport Flexibility**: Support multiple connection methods (stdio, TCP) with automatic fallback

## Architecture

### Core Principles

1. **Process Isolation**: MCP servers always run as separate processes from Lace
2. **Configuration Hierarchy**: Global → Project → Session with server-level replacement
3. **Tool Compatibility**: Leverage existing Lace tool system design that already matches MCP
4. **Transport Flexibility**: Support both stdio and TCP connections with automatic fallback
5. **Clean Integration**: Extend existing `ToolExecutor` without major refactoring

### Component Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   ToolExecutor  │────│  MCPToolRegistry │────│ MCPServerManager│
│   (existing)    │    │     (new)        │    │     (new)       │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                │                        │
                       ┌─────────────────┐    ┌─────────────────┐
                       │  MCPToolAdapter │    │  MCP Server     │
                       │     (new)       │    │  (external)     │
                       └─────────────────┘    └─────────────────┘
```

**MCPServerManager**
- Handles MCP server process lifecycle (spawn/kill/monitor)
- Manages connections (stdio/TCP) with automatic retry
- Health monitoring and automatic restart on crashes
- Lazy server startup for performance optimization

**MCPToolRegistry**
- Discovers and registers MCP tools from all configured servers
- Presents MCP tools through Lace's existing tool interface
- Handles server-to-tool mapping and routing

**MCPToolAdapter**
- Extends existing `Tool` base class for seamless integration
- Dynamically generates Zod schemas from MCP JSON Schema definitions
- Implements `executeValidated()` to make MCP JSON-RPC calls
- Handles MCP-specific error translation and result formatting

## Configuration System

### File Structure

```
~/.lace/mcp-config.json                 # Global MCP configuration
{project}/.lace/mcp-config.json         # Project-specific overrides
packages/core/src/mcp/                  # MCP integration code
packages/web/app/settings/mcp/          # Web UI for MCP management
packages/web/app/api/mcp/               # API routes for MCP management
```

### Configuration Schema

**mcp-config.json Structure:**
```json
{
  "servers": {
    "filesystem": {
      "command": ["node", "filesystem-server.js"],
      "transport": "stdio",
      "enabled": true,
      "tools": {
        "read_file": "allow-session",
        "write_file": "require-approval",
        "delete_file": "deny",
        "list_directory": "allow-project"
      }
    },
    "browser": {
      "command": ["python", "-m", "browser_server"],
      "transport": "tcp",
      "port": 3001,
      "enabled": false,
      "tools": {
        "navigate": "require-approval",
        "screenshot": "allow-always"
      }
    }
  }
}
```

**Configuration Fields:**
- `command`: Array of command and arguments to spawn the MCP server
- `transport`: Connection method ("stdio" or "tcp")
- `port`: TCP port (required for TCP transport)
- `enabled`: Whether the server is enabled (server-level on/off)
- `tools`: Object mapping tool names to approval policies

### Configuration Loading and Merging

1. **Load Global**: `~/.lace/mcp-config.json`
2. **Load Project**: `{project}/.lace/mcp-config.json`
3. **Server-Level Replacement**: If a server exists in both global and project configs, the project version completely replaces the global version (no inheritance of tool policies)
4. **Session Runtime State**: Tracks current approvals and temporary overrides

## Tool System Integration

### Extended Approval Levels

The existing approval system is extended with new levels:

**Current Levels:**
- `allow-once`: Approved for single use
- `allow-session`: Approved for current conversation session  
- `deny`: Tool available but always denied

**New Levels:**
- `disable`: Tool completely disabled (won't appear in AI provider tool lists)
- `allow-project`: Approved for entire project duration
- `allow-always`: Permanently approved (global setting)

**Complete Hierarchy:**
```
disable < deny < require-approval < allow-once < allow-session < allow-project < allow-always
```

### Tool Integration Flow

1. **Server Discovery**: `MCPServerManager` spawns configured MCP servers and maintains connections
2. **Tool Discovery**: `MCPToolRegistry` queries servers for available tools on startup/config changes
3. **Tool Wrapping**: For each MCP tool, `MCPToolAdapter` creates a Lace-compatible wrapper:
   - Converts MCP JSON Schema → Zod schema for validation
   - Implements `Tool` base class interface
   - Handles MCP JSON-RPC calls in `executeValidated()`
4. **Registration**: `ToolExecutor` registers MCP tools alongside native tools
5. **Execution**: Approval policies and execution flow work identically to existing tools

### Transport Layer

**Primary: stdio**
- Spawn MCP server as child process
- Communicate via stdin/stdout JSON-RPC
- Most reliable and widely supported

**Fallback: TCP**
- Connect to pre-running MCP server on specified port
- Useful for persistent servers or debugging
- Automatic connection retry with exponential backoff

**Transport Selection:**
- Primary transport attempted first
- Automatic fallback to secondary transport on failure
- Health monitoring and automatic reconnection

## Web Interface Integration

### Settings Pages

**MCP Server Management (`packages/web/app/settings/mcp/`):**
- Server list with enable/disable toggles
- Add/remove/configure MCP servers
- Server status indicators and health monitoring
- Bulk operations (start all, stop all, restart all)

**Tool Policy Management:**
- Per-server tool listing with approval policy controls
- Bulk policy updates (set all tools in server to same policy)
- Visual indication of policy inheritance (global vs project vs session)

**Project Settings:**
- Project-specific MCP server overrides
- Tool policy customization per project
- Server configuration import/export

### API Routes

```
packages/web/app/api/mcp/
├── servers/
│   ├── route.ts                    # GET/POST server list
│   └── [serverId]/
│       ├── route.ts                # GET/PUT/DELETE specific server
│       ├── status/route.ts         # GET server health/status
│       ├── control/route.ts        # POST start/stop/restart
│       └── tools/
│           ├── route.ts            # GET tools for this server
│           └── [toolId]/
│               └── policy/route.ts # GET/PUT tool approval policy
└── config/
    ├── global/route.ts             # GET/PUT global MCP config
    └── project/route.ts            # GET/PUT project MCP config
```

**Key API Endpoints:**
- `GET /api/mcp/servers` - List configured servers with status
- `POST /api/mcp/servers` - Add new MCP server
- `PUT /api/mcp/servers/[id]` - Update server configuration
- `POST /api/mcp/servers/[id]/control` - Start/stop/restart server
- `GET /api/mcp/servers/[serverId]/tools` - Get tools for specific server
- `PUT /api/mcp/servers/[serverId]/tools/[toolId]/policy` - Set tool approval policy

### UI Components

**Server Status Indicators:**
- Green: Running and healthy
- Yellow: Starting/reconnecting
- Red: Failed/stopped
- Gray: Disabled

**Tool Policy Controls:**
- Dropdown selectors for approval levels
- Visual inheritance indicators
- Bulk policy update controls

**Session Controls:**
- Runtime tool enable/disable toggles
- Temporary approval overrides
- Session-specific policy adjustments

## Implementation Phases

### Phase 1: Core Infrastructure
- `MCPServerManager` with stdio transport support
- `MCPToolRegistry` for tool discovery and registration
- `MCPToolAdapter` extending `Tool` base class
- Basic configuration loading and merging

### Phase 2: Transport and Reliability
- TCP transport support with automatic fallback
- Health monitoring and automatic restart
- Comprehensive error handling and logging
- Server lifecycle management improvements

### Phase 3: Web Interface
- API routes for server and tool management
- Settings pages for MCP configuration
- Real-time server status monitoring
- Tool policy management UI

### Phase 4: Advanced Features
- Configuration import/export
- Server templates and presets
- Performance monitoring and metrics
- Advanced debugging and diagnostic tools

## Security Considerations

- **Process Isolation**: MCP servers run as separate processes to prevent crashes from affecting Lace
- **Approval System**: All MCP tools go through the same approval workflow as native tools
- **Configuration Validation**: All MCP server configurations are validated before execution
- **Resource Limits**: Server process monitoring with automatic restart on crashes or hangs
- **Network Security**: TCP connections limited to localhost by default

## Testing Strategy

- **Unit Tests**: Individual component behavior (adapters, registry, server manager)
- **Integration Tests**: Cross-component interactions and configuration loading
- **E2E Tests**: Full MCP tool execution workflows with real servers
- **Mock Servers**: Lightweight test MCP servers for reliable testing
- **Performance Tests**: Server startup, tool discovery, and execution latency

## Dependencies

- **@modelcontextprotocol/sdk**: Official MCP TypeScript SDK
- **zod-to-json-schema**: For dynamic schema conversion (already used)
- **json-rpc-2.0**: For MCP JSON-RPC communication
- Existing Lace dependencies (zod, better-sqlite3, etc.)

## Migration and Backward Compatibility

- **Zero Breaking Changes**: Existing tool system remains unchanged
- **Additive Integration**: MCP tools appear alongside native tools
- **Configuration**: New configuration files, no changes to existing configs
- **Gradual Adoption**: Users can adopt MCP servers incrementally
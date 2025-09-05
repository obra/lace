# MCP UI Design Specification

## Overview

Multi-scope MCP configuration with clear inheritance and override patterns across Global → Project → Session scopes.

## Design Principles

- **Clear scope indicators** - User always knows what they're configuring
- **Minimal complexity** - No unnecessary reset/revert operations 
- **Inheritance with overrides** - Project can override global, session can override both
- **Server control availability** - Start/stop available in all scopes for global servers
- **Catalog in add dialogs only** - Keep main UI clean, templates in modals

## Scope Hierarchy

### Global Scope (`/settings/mcp`)
**Purpose**: System-wide MCP servers available to all projects

```
┌─────────────────────────────────────────────────────────────────────┐
│ 🌍 Global MCP Settings                                [+ Add Server] │
│ Configure MCP servers available to all projects                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ● filesystem              npx @mcp/server-filesystem    [Stop][Edit] │
│ ├─ [allow-session ▼] read_file                                      │
│ ├─ [require-approval ▼] write_file                                  │
│ └─ [allow-session ▼] list_directory                                 │
│                                                                     │
│ ○ git-server             npx @mcp/server-git           [Start][Edit] │
│ ├─ [allow-always ▼] git_status                                      │
│ ├─ [require-approval ▼] git_commit                                  │
│ └─ [require-approval ▼] git_push                                    │
│                                                                     │
│ No catalog entries shown in main UI - clean server list only       │
└─────────────────────────────────────────────────────────────────────┘

Add Server Dialog:
┌─────────────────────────────────────┐
│ Add Global MCP Server               │
├─────────────────────────────────────┤
│ [Catalog] [Custom]                  │
│                                     │
│ Catalog: 📁 Filesystem              │
│         🔄 Git                     │
│         🌐 Browser                 │
│                                     │
│ Custom: [Name] [Command] [Args]     │
└─────────────────────────────────────┘
```

**Features:**
- ✅ Server lifecycle (start/stop/restart/delete)
- ✅ Tool policy management (inline dropdowns)
- ✅ Server editing dialog
- ✅ Catalog templates in add dialog only
- ✅ Saves to `~/.lace/mcp-config.json`

### Project Scope (`/project/{id}/settings/mcp`)
**Purpose**: Project-specific MCP configuration with global inheritance

```
┌─────────────────────────────────────────────────────────────────────┐
│ 📁 Project MCP Settings - MyProject                  [+ Add Server]  │
│ Configure MCP for this project (inherits from global)              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ Global Servers (inherited):                                        │
│ ● filesystem              npx @mcp/server-filesystem    [Stop][Edit] │
│ ├─ [allow-session ▼] read_file              (inherited)             │
│ ├─ [allow-always ▼] write_file              (overridden) ⚠️         │
│ └─ [allow-session ▼] list_directory         (inherited)             │
│                                                                     │
│ ● git-server             npx @mcp/server-git           [Start][Edit] │
│ ├─ [allow-always ▼] git_status              (inherited)             │
│ ├─ [deny ▼] git_commit                      (overridden) ⚠️         │
│ └─ [require-approval ▼] git_push            (inherited)             │
│                                                                     │
│ Project-Specific Servers:                                           │
│ ● project-docs           node ./docs-indexer.js       [Stop][Edit]  │ 
│ ├─ [allow-always ▼] index_docs                                      │
│ └─ [allow-session ▼] search_docs                                    │
│                                                                     │
│ ● api-server             python ./api-mock.py         [Start][Edit] │
│ └─ [require-approval ▼] mock_api                                    │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- ✅ All global servers with start/stop controls
- ✅ Override indicators for modified policies (⚠️ icon)
- ✅ Project-specific servers 
- ✅ Inherited vs overridden visual distinction
- ✅ No "reset to global" complexity
- ✅ Saves to `{project}/.lace/mcp-config.json`

### Session Scope (chat interface sidebar)
**Purpose**: Real-time tool status and quick controls during conversation

```
┌─────────────────────────────────────┐
│ 🔧 Active MCP Tools                 │
├─────────────────────────────────────┤
│ 📁 Filesystem (3/4 active)    [▼]  │
│ ├─ read_file          [✓ active]   │
│ ├─ write_file         [⚠ pending]  │ 
│ ├─ list_directory     [✓ active]   │
│ └─ delete_file        [✗ disabled] │
│                                     │
│ 🔄 Git (1/3 active)          [▼]  │
│ ├─ git_status         [✓ active]   │
│ ├─ git_commit         [✗ denied]   │
│ └─ git_push           [⚠ approval] │
│                                     │
│ 📄 Docs (2/2 active)         [▼]  │
│ ├─ index_docs         [✓ active]   │
│ └─ search_docs        [✓ active]   │
│                                     │
│ [⚙️ Configure MCP]                  │
└─────────────────────────────────────┘
```

**Features:**
- ✅ Real-time tool availability status
- ✅ Tool usage indicators during conversation
- ✅ Server group collapse/expand
- ✅ Link to project MCP settings
- ✅ Session-scoped visibility (no config changes)

## Technical Architecture

### Configuration Hierarchy
```
Global Config (~/.lace/mcp-config.json)
  └─ Project Config ({project}/.lace/mcp-config.json) [inherits + overrides]
     └─ Session Runtime State [inherits + temporary overrides]
```

### Tool Resolution Priority
1. **Session temporary overrides** (approval responses, disable for conversation)
2. **Project configuration** (project-specific policies)
3. **Global configuration** (system defaults)

### Server Control Rules
- **Global servers**: Start/stop available in all scopes
- **Project servers**: Only controllable within that project
- **Session scope**: View-only, links to configuration

## API Requirements

### Global APIs (existing ✅)
- `GET/POST /api/mcp/servers` - Global server list/create
- `PUT/DELETE /api/mcp/servers/{id}` - Global server edit/delete
- `POST /api/mcp/servers/{id}/control` - Global server start/stop
- `PUT /api/mcp/servers/{id}/tools/{tool}/policy` - Global tool policy

### Project APIs (need to build)
- `GET/POST /api/projects/{id}/mcp/servers` - Project server list/create
- `PUT /api/projects/{id}/mcp/servers/{id}` - Project server edit
- `PUT /api/projects/{id}/mcp/servers/{id}/policies` - Project policy overrides
- `DELETE /api/projects/{id}/mcp/overrides/{server}` - Remove project overrides

### Session APIs (need to build)
- `GET /api/sessions/{id}/mcp/tools` - Available tools with resolved policies
- `PUT /api/sessions/{id}/mcp/tools/{tool}/state` - Temporary enable/disable

## UI Components

### Reusable Components
- **MCPServerList** - Linear server display with controls
- **MCPPolicyDropdown** - Auto-sizing approval level selector  
- **MCPServerCatalog** - Template selection in modals
- **MCPAddServerModal** - Catalog + custom server creation
- **MCPEditServerModal** - Server configuration editing
- **MCPInheritanceIndicator** - Shows inherited vs overridden (⚠️)

### Scope-Specific Components  
- **GlobalMCPSettings** - Full server management
- **ProjectMCPSettings** - Inheritance + project servers + overrides
- **SessionMCPSidebar** - Real-time tool status display

## User Workflows

### Global Setup (Admin)
1. Go to Settings → MCP
2. Add servers from catalog (Filesystem, Git, Browser)
3. Configure default tool policies
4. All projects inherit these by default

### Project Customization (Developer)  
1. Go to Project → Settings → MCP
2. See inherited global servers
3. Override specific tool policies for project needs
4. Add project-specific servers (docs, APIs, etc.)

### Session Monitoring (User)
1. In chat interface, see MCP tools sidebar
2. Monitor which tools are active/available
3. See real-time approval states
4. Quick link to configure if needed

## Implementation Priority

1. **Clean up Global UI** ✅ (current work)
2. **Build reusable components** (MCPPolicyDropdown, MCPAddServerModal, etc.)
3. **Implement Project MCP** with inheritance indicators
4. **Add Session MCP sidebar** for real-time monitoring
5. **Test full workflow** Global → Project → Session

This design provides clear separation of concerns while maintaining usability across all scopes.
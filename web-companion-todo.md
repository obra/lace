# Lace Web Companion UI Implementation Spec

## Task 1: Create Basic Web Server Infrastructure
**Prompt:** "Create a new web server module in `src/interface/web-server.js` that starts alongside the existing console interface. The server should:
- Use Express.js for HTTP serving and WebSocket.io for real-time connections
- Serve static files from a `web/` directory 
- Start automatically when Lace starts (integrate with `src/lace.js`)
- Use the same activity logger and database instances as the console interface
- Add a `--web-port` CLI option (default: 3000) to configure the port
- Include graceful shutdown handling when Lace exits
- Add basic CORS and security headers for local development

The server should leverage existing infrastructure - no new data collection needed."

## Task 2: Implement Real-Time Activity Streaming
**Prompt:** "Create a WebSocket-based activity streaming system that leverages the existing `ActivityLogger`. Implement:
- WebSocket endpoint that streams activity events in real-time
- Event filtering by session ID, agent type, and event type
- JSON event format that matches the existing activity logger schema
- Connection management (handle multiple concurrent browser sessions)
- Backfill recent events when a new client connects (last 50 events)
- Rate limiting to prevent overwhelming browser clients

Use the existing activity logger database as the source of truth - modify `src/logging/activity-logger.js` to emit events via EventEmitter for real-time streaming."

## Task 3: Build Live Conversation View
**Prompt:** "Create the main conversation interface in `web/index.html` and `web/js/conversation.js`. Build:
- Real-time conversation log showing user messages and agent responses
- Token usage display per message (input/output/total counts)
- Cost tracking with running totals
- Message timestamps and session identification
- Auto-scroll to latest messages with scroll-lock toggle
- Basic responsive design that works on desktop and mobile
- Connection status indicator (connected/disconnected to WebSocket)

Use the existing conversation database schema from `src/database/conversation-db.js` for message history."

## Task 4: Create Tool Execution Timeline
**Prompt:** "Implement a tool execution visualization in `web/js/tools.js` that shows:
- Real-time tool call execution with status (pending/running/completed/failed)
- Tool execution timing and duration
- Tool parameters and results (with collapsible details)
- Visual distinction between different tool types (shell, file, search, etc.)
- Filtering by tool type, status, and time range
- Tool result synthesis status (original vs synthesized)
- Error details for failed tool executions

Integrate with the activity logger's tool execution events. Show tool calls in chronological order with clear parent/child relationships."

## Task 5: Build Agent Orchestration Dashboard
**Prompt:** "Create an agent activity dashboard in `web/js/agents.js` that displays:
- Agent spawning hierarchy (parent/child relationships from generation numbers)
- Current agent status (active, idle, completed) based on recent activity
- Agent role assignments and model usage
- Context usage meters showing token consumption per agent
- Agent lifecycle events (spawned, task assigned, completed)
- Visual tree view of agent relationships
- Agent performance metrics (task completion time, token efficiency)

Use existing agent generation tracking and session data to build the visualization."

## Task 6: Implement Project File Browser
**Prompt:** "Build a file browser interface in `web/js/files.js` that leverages existing file tools:
- Directory tree view of the project working directory
- File content viewing with syntax highlighting (use highlight.js)
- Git status integration showing modified/staged/untracked files
- File search functionality using existing search tools
- Diff viewing for modified files (use existing git tools)
- File metadata (size, modification time, permissions)
- Breadcrumb navigation and file path display

Use the existing `FileTool` and `ShellTool` APIs via new web API endpoints. Make file operations read-only for now."

## Task 7: Add API Endpoints for UI Data
**Prompt:** "Create REST API endpoints in the web server to support the UI components:
- `GET /api/sessions` - List available conversation sessions
- `GET /api/sessions/:id/messages` - Get conversation history for a session
- `GET /api/sessions/:id/agents` - Get agent hierarchy for a session  
- `GET /api/sessions/:id/tools` - Get tool execution history
- `GET /api/files/*` - Serve file content with appropriate MIME types
- `GET /api/git/status` - Get git repository status
- `GET /api/git/diff/:file` - Get file diff
- `POST /api/search` - Search files using existing search tools

All endpoints should use existing database and tool infrastructure. Add proper error handling and request validation."

## Task 8: Create Basic UI Layout and Styling
**Prompt:** "Design and implement the overall UI layout in `web/css/styles.css` and update `web/index.html`:
- Split-pane layout: conversation log on left, activity dashboard on right
- Tabbed interface for switching between agents, tools, and files views
- Dark theme that matches terminal aesthetics
- Responsive design that works on different screen sizes
- Loading states and error handling in the UI
- Keyboard shortcuts for common actions (refresh, clear, toggle views)
- Print-friendly stylesheet for exporting conversations

Keep the design minimal and functional - focus on information density and readability."

## Task 9: Integration and Testing
**Prompt:** "Integrate the web companion with the main Lace application and create tests:
- Update `src/lace.js` to start the web server alongside the console interface
- Add web server configuration to the main CLI options
- Create integration tests that verify WebSocket connectivity and API endpoints
- Test real-time updates work correctly with multiple browser sessions
- Verify that the web UI doesn't interfere with console operation
- Add error handling for port conflicts and server startup failures
- Create documentation for accessing and using the web companion

Ensure the web companion is completely optional - Lace should work normally if the web server fails to start."

## Implementation Notes:
- Leverage existing infrastructure wherever possible (activity logger, database, tools)
- Keep the web UI read-only for now - no interactive features
- Use modern browser APIs but maintain compatibility with recent Chrome/Firefox/Safari
- All real-time features should gracefully degrade if WebSocket connection fails
- The web companion should not impact console performance or functionality
- File serving should respect .gitignore patterns and security boundaries
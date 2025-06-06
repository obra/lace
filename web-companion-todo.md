# Lace Web Companion UI Implementation Spec

## ✅ Task 1: Create Basic Web Server Infrastructure - COMPLETED
**Status:** Fully implemented with Express.js and Socket.io
**Implementation:**
- ✅ Web server module in `src/interface/web-server.js` with Express.js and Socket.io
- ✅ Static file serving from `web/` directory
- ✅ Integrated with `src/lace.js` and console interface
- ✅ Shared activity logger and database instances
- ✅ `--web-port` CLI option (default: 3000) in `src/cli.js`
- ✅ Graceful shutdown handling and error management
- ✅ CORS and security headers with Helmet middleware
- ✅ WebSocket connection management with rate limiting
- ✅ Health check endpoint and status monitoring

## ✅ Task 2: Implement Real-Time Activity Streaming - COMPLETED
**Status:** Full WebSocket streaming system implemented
**Implementation:**
- ✅ WebSocket endpoint with real-time activity event streaming
- ✅ Advanced event filtering by session ID, agent type, and event type
- ✅ JSON event format matching existing activity logger schema
- ✅ Multi-client connection management with session subscription
- ✅ Backfill of last 50 events on client connect
- ✅ Rate limiting (max 10 events/second per client)
- ✅ Enhanced `ActivityLogger` with EventEmitter for real-time streaming
- ✅ Event deduplication and chronological ordering
- ✅ Connection status monitoring and automatic reconnection

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

## ✅ Task 9: Integration and Testing - COMPLETED
**Status:** Full integration and testing implemented
**Implementation:**
- ✅ Web server integrated into `src/lace.js` with graceful startup/shutdown
- ✅ CLI option `--web-port` added to `src/cli.js` (default: 3000)
- ✅ Comprehensive test suite covering unit, API, and integration tests
- ✅ Error handling for port conflicts and startup failures
- ✅ Optional startup - Lace continues in console-only mode if web server fails
- ✅ TypeScript configuration for Jest ES modules support
- ✅ Documentation created in `docs/web-companion.md`
- ✅ Real-time WebSocket connectivity verified through testing
- ✅ Multi-browser session support validated
- ✅ Web UI operates independently without interfering with console

## Implementation Notes:
- Leverage existing infrastructure wherever possible (activity logger, database, tools)
- Keep the web UI read-only for now - no interactive features
- Use modern browser APIs but maintain compatibility with recent Chrome/Firefox/Safari
- All real-time features should gracefully degrade if WebSocket connection fails
- The web companion should not impact console performance or functionality
- File serving should respect .gitignore patterns and security boundaries
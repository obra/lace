# Lace Web Companion

The Lace Web Companion provides a real-time web interface for monitoring and interacting with your agentic coding environment. It runs alongside the console interface and offers comprehensive visibility into conversation history, tool execution, agent orchestration, and project files.

## Features

### Real-time Activity Monitoring
- **Live Conversation View**: See user messages and agent responses in real-time
- **Tool Execution Timeline**: Monitor tool calls with status, parameters, and results
- **Agent Orchestration Dashboard**: Track agent hierarchy and performance metrics
- **Activity Stream**: Real-time event feed with filtering capabilities

### Project Management
- **File Browser**: Navigate project files with syntax highlighting
- **Git Integration**: View file status, diffs, and repository information
- **Search Functionality**: Search across project files and content

### User Interface
- **Split-pane Layout**: Conversation on left, activity dashboard on right
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Dark Theme**: Matches terminal aesthetics for consistent experience
- **Keyboard Shortcuts**: Quick navigation and control
- **Print-friendly**: Export conversations and activity logs

## Getting Started

### Automatic Startup
The web companion starts automatically when you run Lace:

```bash
lace --web-port 3000
```

### Accessing the Interface
Open your browser and navigate to:
```
http://localhost:3000
```

### Configuration Options
- `--web-port <port>`: Set web server port (default: 3000)
- `--verbose`: Enable detailed logging for web server
- `--no-interactive`: Disable interactive features (web companion remains read-only)

## Architecture

### Web Server
- **Express.js**: HTTP server for static files and API endpoints
- **Socket.io**: WebSocket server for real-time communication
- **Security**: Helmet middleware, CORS configuration, input validation

### Real-time Data Flow
1. **Activity Logger** captures events from Lace operations
2. **WebSocket Server** broadcasts events to connected clients
3. **React UI** receives and displays real-time updates
4. **API Endpoints** provide historical data and system metrics

### API Endpoints

#### Core Endpoints
- `GET /api/health` - Health check and connection status
- `GET /api/sessions` - List available conversation sessions
- `GET /api/sessions/:id/messages` - Get conversation history
- `GET /api/sessions/:id/tools` - Get tool execution history
- `GET /api/sessions/:id/agents` - Get agent hierarchy

#### Enhanced Endpoints
- `GET /api/sessions/:id/analytics` - Detailed session analytics
- `GET /api/system/metrics` - System performance metrics
- `GET /api/activity/events` - Activity event stream
- `GET /api/files/tree` - Project file tree
- `GET /api/git/status` - Git repository status
- `POST /api/search` - Search project files

### WebSocket Events

#### Outgoing (Server to Client)
- `activity` - Real-time activity events
- `connect` - Connection established
- `disconnect` - Connection lost

#### Incoming (Client to Server)
- `subscribe-session` - Subscribe to session-specific events
- `unsubscribe-session` - Unsubscribe from session events
- `filter-activity` - Apply event filtering

## UI Components

### Conversation View
- **Message History**: Chronological display of user and agent messages
- **Token Usage**: Input/output token counts per message
- **Cost Tracking**: Running totals and cost estimates
- **Session Management**: Switch between conversation sessions
- **Auto-scroll**: Automatic scrolling with manual override

### Tools Timeline
- **Execution Status**: Pending, running, completed, failed states
- **Tool Parameters**: Collapsible display of input parameters
- **Results Display**: Tool outputs with syntax highlighting
- **Duration Tracking**: Execution timing and performance metrics
- **Error Details**: Comprehensive error information for failed tools

### Agents Dashboard
- **Agent Hierarchy**: Visual tree of parent-child relationships
- **Status Indicators**: Active, idle, completed agent states
- **Performance Metrics**: Token efficiency, task completion times
- **Role Assignments**: Agent roles and model configurations
- **Capability Tracking**: Available tools and permissions per agent

### File Browser
- **Directory Tree**: Hierarchical project file navigation
- **Syntax Highlighting**: Code display with language detection
- **Git Integration**: File status indicators (modified, staged, untracked)
- **Search Results**: File content search with context
- **Diff Viewing**: Side-by-side comparison for modified files

## Security and Performance

### Security Measures
- **Helmet Middleware**: Security headers for XSS protection
- **CORS Configuration**: Controlled cross-origin access
- **Input Validation**: API parameter sanitization
- **Path Sanitization**: Safe file system access
- **Error Sanitization**: Prevent information leakage

### Performance Optimizations
- **Event Deduplication**: Prevent duplicate activity events
- **Connection Management**: Efficient WebSocket handling
- **Rate Limiting**: Prevent WebSocket flooding
- **Static Caching**: Optimized file serving
- **Graceful Degradation**: Fallback when WebSocket unavailable

## Error Handling

### Startup Failures
The web companion is designed to be completely optional. If the web server fails to start:
- Lace continues in console-only mode
- Error is logged (if verbose mode enabled)
- No impact on core functionality

### Runtime Errors
- **Database Unavailable**: API endpoints return appropriate error responses
- **WebSocket Disconnections**: Automatic reconnection attempts
- **Port Conflicts**: Clear error messages and graceful shutdown
- **File System Errors**: Safe handling of missing or inaccessible files

## Keyboard Shortcuts

- `Ctrl+1-4`: Switch between tabs (Conversation, Tools, Agents, Files)
- `Ctrl+R`: Refresh the page
- `Ctrl+L`: Toggle left pane (conversation view)
- `Ctrl+K`: Toggle right pane (activity dashboard)

## Browser Compatibility

### Supported Browsers
- Chrome/Chromium 90+
- Firefox 88+
- Safari 14+
- Edge 90+

### Required Features
- ES6 Modules
- WebSocket support
- CSS Grid and Flexbox
- Modern JavaScript APIs

## Troubleshooting

### Common Issues

**Web companion not accessible**
- Check that Lace is running with web server enabled
- Verify the port is not blocked by firewall
- Try a different port with `--web-port <port>`

**Real-time updates not working**
- Check browser console for WebSocket errors
- Verify network connectivity
- Refresh the page to reconnect

**Performance issues**
- Close unused browser tabs
- Check system resources (memory, CPU)
- Consider reducing activity filtering scope

### Debug Mode
Enable verbose logging for detailed information:
```bash
lace --verbose --web-port 3000
```

## Development

### File Structure
```
web/
├── index.html          # Main HTML page
├── css/
│   └── styles.css      # Comprehensive styling
└── js/
    ├── app.js          # Main React application
    ├── conversation.js # Conversation view component
    ├── tools.js        # Tools timeline component
    ├── agents.js       # Agents dashboard component
    └── files.js        # File browser component
```

### Testing
Run the test suite to verify web companion functionality:
```bash
npm test
```

The test suite includes:
- **Unit tests** (`test/unit/`) for core functionality
- **API endpoint validation** tests for structure and error handling
- **Integration documentation** tests verifying completeness
- **Additional integration tests** available in `test/integration/` for comprehensive testing

**Note**: Full integration tests with WebSocket connectivity and HTTP requests are available in:
- `test/integration/basic-integration.test.js` - Server startup/shutdown testing
- `test/integration/web-companion-integration.test.js` - Comprehensive real-time testing

These require additional Jest configuration for ES modules and can be run individually for development testing.

### Contributing
When modifying the web companion:
1. Follow existing code style and patterns
2. Add tests for new functionality
3. Update documentation as needed
4. Ensure graceful degradation
5. Test across supported browsers

## License

The Lace Web Companion is part of the Lace project and is released under the MIT License.
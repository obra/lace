# Lace - Your lightweight agentic coding environment

## Quick Start

### 1. Setup API Key
```bash
# Create the API key directory
mkdir -p ~/.lace/api-keys

# Add your Anthropic API key
echo "your-actual-anthropic-api-key-here" > ~/.lace/api-keys/anthropic
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Lace
```bash
# Interactive mode (console only)
npm start

# Or directly
node src/cli.js

# With verbose output
node src/cli.js --verbose

# With web companion (browser + console)
node src/cli.js --web --port 3000
```

### 4. Try Some Commands
```
lace> list files
lace> calculate 2 + 2 * 5
lace> run pwd
lace> plan how to implement user authentication
lace> /help
lace> /quit
```

## CLI Options

```bash
Usage: lace [options]

Your lightweight agentic coding environment

Options:
  -V, --version         output the version number
  -v, --verbose         enable verbose output
  --memory-path <path>  path to conversation database (default: "./lace-memory.db")
  --web                 start web companion interface
  --port <number>       web server port (default: 3000)
  -h, --help            display help for command
```

## What Lace Can Do

### 🤖 **AI-Powered Assistance**
- Natural language interaction with Claude AI
- Context-aware responses that remember your conversation
- Intelligent task analysis and execution

### 🛠️ **Tool Integration**
- **File Operations**: Read, write, edit, and search files
- **Shell Commands**: Execute system commands safely
- **JavaScript Evaluation**: Calculate expressions and process data
- **Text Search**: Find content across your codebase

### 🎭 **Smart Agent System**
- **Orchestrator**: Analyzes tasks and chooses optimal approaches
- **Specialized Agents**: Different AI models for different task types
- **Cost Optimization**: Uses faster models for simple tasks, powerful models for complex ones

### 💾 **Persistent Memory**
- Remembers all conversations in SQLite database
- Never loses context between sessions
- Query conversation history with `/memory`

### 🌐 **Web Companion Interface**
- **Real-time Dashboard**: Live view of AI conversations and tool execution
- **Project Browser**: Navigate and view project files with syntax highlighting
- **Activity Timeline**: Visual timeline of all agent activities and tool calls
- **Agent Orchestration**: Monitor agent handoffs and specialization
- **WebSocket Streaming**: Real-time updates without page refresh
- **System Metrics**: Performance monitoring and resource usage
- **Dual Interface**: Use both console and web interface simultaneously

## Example Sessions

### Console Interface
```
🧵 Lace - Your lightweight agentic coding environment
Starting session: session-1749094234634
Type /help for commands, /quit to exit

lace> list files in this directory
I'll help you list the files in the current directory.

📁 src
📁 test  
📄 package.json
📄 README.md
📄 SPEC.md
📄 ARCHITECTURE.md

Tool calls executed:
  file_list({"path":"."})

lace> calculate the fibonacci sequence for n=10
I'll calculate the 10th Fibonacci number using JavaScript.

The 10th Fibonacci number is: 55

Here's the sequence up to the 10th position:
[0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

Tool calls executed:
  javascript_evaluate({"code":"..."})

lace> /quit
Goodbye!
```

### Web Companion Interface
```bash
# Start with web companion
node src/cli.js --web --port 3000

🧵 Lace - Your lightweight agentic coding environment
🌐 Web companion available at http://localhost:3000
Starting session: session-1749094234634
Type /help for commands, /quit to exit

lace> analyze this codebase
```

Then open http://localhost:3000 to see:
- **Live Dashboard**: Real-time conversation view
- **File Browser**: Navigate project files with syntax highlighting  
- **Activity Timeline**: Visual tool execution and agent activity
- **System Metrics**: Performance and usage statistics
- **Agent Monitor**: Track agent handoffs and specializations

## Available Commands

### **Interactive Commands**
- `list files` - Show directory contents
- `calculate <expression>` - Evaluate mathematical expressions  
- `run <command>` - Execute shell commands
- `plan <task>` - Get AI-powered planning assistance

### **Console Commands**
- `/help` - Show available commands
- `/tools` - List available tools
- `/memory` - Show conversation history
- `/quit` - Exit Lace

## Architecture

Lace uses an **orchestrator-driven agent system**:

- **Primary Agent**: Analyzes your requests and coordinates responses
- **Subagents**: Specialized workers for different types of tasks
- **Model Selection**: Automatically chooses the right AI model for each task
- **Tool Integration**: Seamlessly uses tools to accomplish real work

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed system design.

## Requirements

- Node.js 18.0.0 or higher
- Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com))

## Troubleshooting

### API Key Issues
```bash
# Check if API key file exists
cat ~/.lace/api-keys/anthropic

# Make sure it contains your actual key, not a placeholder
```

### Permission Issues
```bash
# Make sure the CLI is executable
chmod +x src/cli.js
```

### Database Issues
```bash
# Remove the database file to start fresh
rm lace-memory.db
```

## Development

```bash
# Run in development mode with auto-restart
npm run dev

# Run tests
npm test

# Format code
npm run format

# Lint code
npm run lint
```
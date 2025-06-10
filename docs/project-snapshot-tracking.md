# Project Snapshot Tracking System

## Overview

The Lace Snapshot Safety Net is a development-time safety system that automatically captures project state at every tool execution without polluting the main git history. It provides time-travel recovery capabilities, allowing developers to safely restore their project to any previous state during development.

## Architecture

### Core Components

The snapshot system consists of five main components working together:

#### 1. GitOperations (`src/snapshot/git-operations.js`)

- Manages git operations using a separate git directory (`.lace/history-snapshot-dotgit`)
- Handles repository initialization, commits, and restoration operations
- Uses `simple-git` library for reliable git command execution
- Provides atomic operations with comprehensive error handling

#### 2. SnapshotManager (`src/snapshot/snapshot-manager.js`)

- Orchestrates snapshot creation and management
- Integrates with context capture for rich metadata
- Handles configuration, retention policies, and performance optimization
- Provides APIs for manual checkpoints and automatic tool snapshots

#### 3. ContextCapture (`src/snapshot/context-capture.js`)

- Enriches snapshots with conversation and activity context
- Integrates with ConversationDB and ActivityLogger
- Provides semantic analysis and search term generation
- Gracefully degrades when context services are unavailable

#### 4. RestoreOperations (`src/snapshot/restore-operations.js`)

- Handles comprehensive restoration and recovery functionality
- Provides preview capabilities and safety validations
- Supports both full project and selective file restoration
- Includes smart recommendations and related snapshot discovery

#### 5. SnapshotCLI (`src/snapshot/snapshot-cli.js`)

- User-friendly command-line interface for snapshot management
- Interactive features with colored output and confirmations
- Comprehensive browsing, inspection, and restoration commands
- Built-in help system and usage examples

### Directory Structure

```
.lace/
├── history-snapshot-dotgit/        # Separate git repository for snapshots
├── snapshots/
│   ├── index.json                  # Fast snapshot catalog
│   └── metadata/                   # Individual snapshot metadata files
└── snapshot-config.json           # Configuration and retention policies
```

### Integration Points

#### Tool Registry Integration

The system integrates with Lace's ToolRegistry (`src/tools/tool-registry.js`) through the `callToolWithSnapshots()` method:

```javascript
// Automatic snapshot creation around tool execution
const result = await toolRegistry.callToolWithSnapshots("file-tool", "write", {
  path: "file.js",
  content: "code",
});
```

This creates:

1. **Pre-tool snapshot**: Captures state before tool execution
2. **Tool execution**: Runs the actual tool operation
3. **Post-tool snapshot**: Captures state after successful execution

## Usage Guide

### Automatic Snapshots

Snapshots are created automatically when tools are executed through the integrated ToolRegistry:

- **Pre-tool snapshots**: Capture project state before any tool execution
- **Post-tool snapshots**: Capture state after successful tool completion
- **Error snapshots**: Optionally capture state when tools fail (configurable)

### Manual Checkpoints

Create manual snapshots at important development milestones:

```javascript
const snapshotManager = new SnapshotManager(projectPath);
await snapshotManager.initialize();

// Create a checkpoint before major changes
await snapshotManager.createCheckpoint("Before implementing new feature");
```

### CLI Commands

#### Listing Snapshots

```bash
# List all snapshots
lace snapshot list

# Filter by type
lace snapshot list --type=checkpoint
lace snapshot list --type=pre-tool

# Show system statistics
lace snapshot stats
```

#### Inspecting Snapshots

```bash
# View detailed snapshot information
lace snapshot inspect 2025-06-05T15-30-00-checkpoint

# Include related snapshots
lace snapshot inspect abc123 --related
```

#### Restoration Preview

```bash
# Preview changes before restoring
lace snapshot preview 2025-06-05T15-30-00-checkpoint

# Preview specific file restoration
lace snapshot preview-files abc123 src/main.js package.json
```

#### Restoration

```bash
# Restore complete project state
lace snapshot restore 2025-06-05T15-30-00-checkpoint

# Force restore (bypasses safety checks)
lace snapshot restore abc123 --force --backup

# Restore specific files only
lace snapshot restore-files abc123 src/main.js package.json
```

#### Getting Help

```bash
# Show restoration recommendations
lace snapshot recommendations

# Get help and examples
lace snapshot help
lace snapshot examples
```

## Snapshot Types

### Checkpoint

- **Purpose**: Manual snapshots created by developers
- **When**: Before major changes, at development milestones
- **Naming**: `YYYY-MM-DDTHH-mm-ss-checkpoint`
- **Retention**: Longest retention, typically kept indefinitely

### Pre-tool

- **Purpose**: Automatic snapshots before tool execution
- **When**: Before any tool modifies project state
- **Naming**: `YYYY-MM-DDTHH-mm-ss-pre-tool-{executionId}`
- **Retention**: Medium retention, paired with post-tool snapshots

### Post-tool

- **Purpose**: Automatic snapshots after successful tool execution
- **When**: After tool completes successfully
- **Naming**: `YYYY-MM-DDTHH-mm-ss-post-tool-{executionId}`
- **Retention**: Medium retention, shows final state after changes

## Metadata Structure

Each snapshot includes comprehensive metadata:

```javascript
{
  snapshotId: "2025-06-05T15-30-00-checkpoint",
  type: "checkpoint",
  timestamp: "2025-06-05T15:30:00Z",
  gitCommitSha: "abc123def456",
  description: "Before implementing new feature",

  // Tool execution context (for tool snapshots)
  toolCall: {
    toolName: "file-tool",
    operation: "write",
    parameters: { path: "src/main.js" },
    executionId: "exec-123"
  },

  // Execution results (for post-tool snapshots)
  executionResult: {
    success: true,
    duration: 150,
    error: null
  },

  // Performance metrics
  performance: {
    filesChanged: 3,
    snapshotSizeBytes: 2048,
    processingTimeMs: 45
  },

  // Rich context (when available)
  context: {
    conversationTurn: 42,
    recentActivity: [...],
    semanticHints: [...]
  }
}
```

## Configuration

### Snapshot Configuration

Configure behavior in `.lace/snapshot-config.json`:

```javascript
{
  enabled: true,
  retention: {
    maxSnapshots: 1000,
    maxAge: "30d",
    maxSize: "1GB"
  },
  types: {
    checkpoint: { retain: "forever" },
    "pre-tool": { retain: "7d" },
    "post-tool": { retain: "7d" }
  },
  exclusions: [
    "node_modules/",
    ".git/",
    "*.log",
    "tmp/"
  ]
}
```

### Performance Optimization

- **Exclusion patterns**: Skip large directories and temporary files
- **Compression**: Automatic git compression for storage efficiency
- **Background operations**: Non-blocking snapshot creation
- **Caching**: Fast metadata lookup through index files

## Safety Features

### Working Tree Validation

Before restoration, the system checks:

- Uncommitted changes in working tree
- Untracked files that might be overwritten
- Conflicting operations in progress

### Safety Recommendations

When unsafe conditions are detected:

- Suggests committing or stashing changes
- Offers to create backup branches
- Provides force mode for override when necessary

### Atomic Operations

All operations are atomic:

- Snapshots either complete fully or fail cleanly
- Restoration operations can be rolled back
- No partial states that could corrupt the project

## Recovery Scenarios

### Common Recovery Patterns

#### Undo Last Tool Execution

```bash
# Find the pre-tool snapshot before the problematic operation
lace snapshot list --type=pre-tool

# Preview and restore
lace snapshot preview 2025-06-05T15-35-00-pre-tool-file123
lace snapshot restore 2025-06-05T15-35-00-pre-tool-file123
```

#### Restore to Last Known Good State

```bash
# Get AI recommendations for best restoration points
lace snapshot recommendations

# Restore to recommended checkpoint
lace snapshot restore 2025-06-05T15-30-00-checkpoint
```

#### Selective File Recovery

```bash
# Restore just the files you need
lace snapshot restore-files abc123 src/main.js package.json

# Preview changes first
lace snapshot preview-files abc123 src/main.js
```

## Integration with Development Workflow

### Typical Development Session

1. **Start development**: System automatically initializes snapshot tracking
2. **Tool execution**: Each tool operation creates pre/post snapshots
3. **Manual checkpoints**: Developer creates checkpoints at key milestones
4. **Recovery**: When needed, browse and restore from any previous state
5. **Cleanup**: Automatic retention policies keep system performant

### Best Practices

- Create checkpoints before major refactoring
- Use descriptive messages for manual checkpoints
- Preview changes before restoration
- Check recommendations for optimal restoration points
- Regular cleanup through retention policies

## Troubleshooting

### Common Issues

#### Git Repository Conflicts

If the main project has git issues, the snapshot system operates independently:

- Uses separate git directory (`.lace/history-snapshot-dotgit`)
- No interference with main project git operations
- Can restore even when main git is corrupted

#### Storage Space

Monitor and manage snapshot storage:

```bash
# Check storage usage
lace snapshot stats

# Manual cleanup (if needed)
lace snapshot cleanup --older-than=7d
```

#### Performance

Optimize for large projects:

- Configure exclusion patterns for large directories
- Adjust retention policies for your usage patterns
- Use selective restoration instead of full project restoration

### Error Recovery

The system is designed for graceful degradation:

- Context capture failures don't prevent snapshots
- Git operation failures are logged but don't stop tool execution
- Metadata corruption is isolated to individual snapshots

## API Reference

### SnapshotManager

```javascript
// Initialize
const manager = new SnapshotManager(projectPath, options);
await manager.initialize();

// Create snapshots
await manager.createCheckpoint(description);
await manager.createPreToolSnapshot(toolCall, context);
await manager.createPostToolSnapshot(toolCall, result, context);

// Query snapshots
const snapshots = await manager.listSnapshots(filters);
const metadata = await manager.loadSnapshotMetadata(snapshotId);
```

### RestoreOperations

```javascript
// Initialize
const restore = new RestoreOperations(snapshotManager, gitOps, projectPath);

// Preview operations
const preview = await restore.previewRestore(snapshotId);
const filePreview = await restore.previewFileRestore(snapshotId, filePaths);

// Restoration
const result = await restore.restoreFromSnapshot(snapshotId, options);
const fileResult = await restore.restoreFiles(snapshotId, filePaths);
```

### CLI Integration

```javascript
// Initialize CLI
const cli = new SnapshotCLI(snapshotManager, restoreOps, options);

// Execute commands
await cli.listSnapshots(filters);
await cli.inspectSnapshot(snapshotId, options);
await cli.restoreFromSnapshot(snapshotId, options);
```

## Testing

The snapshot system includes comprehensive test coverage:

- **Unit tests**: 82 tests across all components
- **Integration tests**: Test component interactions
- **CLI tests**: Verify user interface functionality
- **Safety tests**: Validate error handling and recovery

Run tests with:

```bash
npm test
```

## Future Enhancements

Potential future improvements:

- Snapshot compression and deduplication
- Remote snapshot storage and sharing
- Integration with external backup systems
- Enhanced AI-driven recovery recommendations
- Visual diff tools for snapshot comparison

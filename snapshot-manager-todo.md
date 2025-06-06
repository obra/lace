# Lace Snapshot System Implementation TODO

## Overview
Development-time safety net using a separate git repository to track all project changes at every tool execution. Provides time-travel capabilities to recover from agent mistakes without polluting the main project git history.

## Core Architecture

```
.lace/
├── history-snapshot-dotgit/        # Git metadata for snapshots
├── snapshots/
│   ├── index.json                  # Snapshot index/catalog
│   └── metadata/
│       ├── 20250605-143052-pre-tool-abc123.json
│       ├── 20250605-143053-post-tool-abc123.json
│       └── ...
└── snapshot-config.json           # Configuration
```

## Implementation Tasks

### Phase 1: Core Infrastructure
- [ ] Create `src/snapshot/` directory structure
- [ ] Implement `GitOperations` class (`src/snapshot/git-operations.js`)
  - [ ] Git commands with custom `--git-dir=.lace/history-snapshot-dotgit`
  - [ ] Repository initialization
  - [ ] Atomic commit operations
  - [ ] Repository maintenance and cleanup
- [ ] Implement `SnapshotManager` class (`src/snapshot/snapshot-manager.js`)
  - [ ] Core snapshot creation
  - [ ] Metadata management
  - [ ] Configuration loading
  - [ ] Snapshot indexing and cataloging

### Phase 2: Context Capture
- [ ] Implement `ContextCapture` class (`src/snapshot/context-capture.js`)
  - [ ] Integration with ConversationDB
  - [ ] Integration with ActivityLogger
  - [ ] Real repository SHA capture
  - [ ] Tool execution context capture
  - [ ] System state capture

### Phase 3: Tool Integration
- [ ] Modify `ToolRegistry.executeToolCall()` in `src/tools/tool-registry.js`
  - [ ] Pre-tool snapshot creation
  - [ ] Post-tool snapshot creation (success/error)
  - [ ] Context passing to snapshot system
- [ ] Initialize SnapshotManager in `src/lace.js`
- [ ] Add SnapshotManager to agent context

### Phase 4: Recovery Operations
- [ ] Implement `RestoreOperations` class (`src/snapshot/restore-operations.js`)
  - [ ] Full project restore
  - [ ] Selective file restore
  - [ ] Preview mode (diff without changes)
  - [ ] Safety checks and backups
  - [ ] Atomic restore operations
  - [ ] Integrity verification

### Phase 5: CLI Interface
- [ ] Implement `SnapshotCLI` class (`src/snapshot/snapshot-cli.js`)
- [ ] Add CLI commands to `src/cli.js`:
  - [ ] `lace snapshot list [--since] [--tool] [--type]`
  - [ ] `lace snapshot browse` (interactive)
  - [ ] `lace snapshot restore <id> [--files] [--preview]`
  - [ ] `lace snapshot diff <from> <to>`
  - [ ] `lace snapshot checkpoint <description>`
  - [ ] `lace snapshot prune [--dry-run]`

### Phase 6: Configuration & Performance
- [ ] Create default `.lace/snapshot-config.json`
- [ ] Implement retention policies
- [ ] Add exclusion patterns (.gitignore style)
- [ ] Background pruning system
- [ ] Compression optimization
- [ ] Performance monitoring

## Data Structures

### Snapshot Metadata
```javascript
{
  "snapshotId": "20250605-143052-pre-tool-abc123",
  "timestamp": "2025-06-05T14:30:52.123Z",
  "type": "pre-tool|post-tool|manual|checkpoint",
  "gitCommitSha": "a1b2c3d4...",  // Snapshot repo commit
  "realRepoSha": "e5f6g7h8...",   // Real project repo SHA
  "toolCall": {
    "toolName": "file-tool",
    "operation": "write",
    "parameters": {...},
    "executionId": "tool-exec-123"
  },
  "context": {
    "conversationTurns": 5,
    "recentHistory": [...],
    "recentToolUses": [...],
    "activeAgent": "coding-agent"
  },
  "performance": {
    "filesChanged": 3,
    "snapshotSizeBytes": 1245232,
    "processingTimeMs": 45
  }
}
```

### Configuration Schema
```javascript
{
  "enabled": true,
  "retentionPolicy": {
    "maxAge": "7 days",
    "maxSnapshots": 1000,
    "keepCheckpoints": true
  },
  "performance": {
    "excludePatterns": ["node_modules/**", "*.log", ".DS_Store"],
    "compressionLevel": 6,
    "backgroundPruning": true
  },
  "integration": {
    "autoSnapshotOnToolUse": true,
    "conversationTurnsToCapture": 5,
    "toolUsesToCapture": 10
  }
}
```

## Key Implementation Details

### Git Operations
- Use `git --git-dir=.lace/history-snapshot-dotgit --work-tree=.` for all operations
- Exclude `.git/` directory from snapshots via `.gitignore`
- Single-line commit messages with timestamp and context
- Delta compression for storage efficiency

### Tool Integration Points
1. **ToolRegistry.executeToolCall()** - Automatic pre/post snapshots
2. **Agent conversation loop** - Manual checkpoints
3. **Error handling** - Capture error state in post-tool snapshots
4. **Context capture** - Integration with existing logging systems

### Safety Features
- Emergency backup before any restore operation
- Uncommitted changes detection
- Atomic restore operations
- Integrity verification
- Preview mode for all operations

## Testing Requirements
- [ ] Unit tests for all core classes
- [ ] Integration tests with existing tool system
- [ ] Performance tests with large repositories
- [ ] Recovery scenario tests
- [ ] CLI command tests

## Documentation
- [ ] API documentation for SnapshotManager
- [ ] CLI usage documentation
- [ ] Recovery procedures documentation
- [ ] Performance tuning guide
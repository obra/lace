// ABOUTME: Command-line interface for snapshot management with user-friendly browsing and restoration
// ABOUTME: Provides interactive commands for developers to safely navigate and restore project snapshots

export class SnapshotCLI {
  constructor(snapshotManager, restoreOperations, options = {}) {
    if (!snapshotManager) {
      throw new Error('SnapshotManager is required for CLI operations');
    }
    if (!restoreOperations) {
      throw new Error('RestoreOperations is required for CLI operations');
    }

    this.snapshotManager = snapshotManager;
    this.restoreOps = restoreOperations;
    
    // Configure output and interaction
    this.output = options.output || console;
    this.interactive = options.interactive !== false; // Default to true
    this.colors = options.colors !== false; // Default to true
    this.prompt = options.prompt || null; // For testing, can inject mock prompts
  }

  /**
   * List snapshots with optional filtering
   */
  async listSnapshots(options = {}) {
    try {
      const snapshots = await this.snapshotManager.listSnapshots(options);
      
      if (snapshots.length === 0) {
        this.output.info('No snapshots found.');
        return;
      }

      // Format snapshots for table display
      const tableData = snapshots.map(snapshot => ({
        snapshotId: snapshot.snapshotId,
        type: snapshot.type.toUpperCase(),
        timestamp: this.formatTimestamp(snapshot.timestamp),
        description: this.getSnapshotDescription(snapshot),
        size: snapshot.performance ? this.formatFileSize(snapshot.performance.snapshotSizeBytes) : 'N/A'
      }));

      this.output.log(this.colorize('\n📸 Available Snapshots', 'header'));
      this.output.table(tableData);
      
      this.output.log(`\nTotal: ${snapshots.length} snapshot${snapshots.length !== 1 ? 's' : ''}`);
      
    } catch (error) {
      this.output.error(`Failed to list snapshots: ${error.message}`);
    }
  }

  /**
   * Show system statistics
   */
  async showSystemStats() {
    try {
      const stats = await this.snapshotManager.getSystemStats();
      
      this.output.log(this.colorize('\n📊 Snapshot System Statistics', 'header'));
      this.output.log(`Total snapshots: ${this.colorize(stats.totalSnapshots, 'number')}`);
      this.output.log(`Total size: ${this.colorize(this.formatFileSize(stats.totalSize), 'number')}`);
      this.output.log(`Average snapshot size: ${this.colorize(this.formatFileSize(stats.averageSnapshotSize), 'number')}`);
      
      if (stats.oldestSnapshot) {
        this.output.log(`Oldest snapshot: ${this.colorize(this.formatTimestamp(stats.oldestSnapshot), 'date')}`);
      }
      if (stats.newestSnapshot) {
        this.output.log(`Newest snapshot: ${this.colorize(this.formatTimestamp(stats.newestSnapshot), 'date')}`);
      }
      
    } catch (error) {
      this.output.error(`Failed to get system statistics: ${error.message}`);
    }
  }

  /**
   * Inspect detailed snapshot information
   */
  async inspectSnapshot(snapshotId, options = {}) {
    try {
      const snapshot = await this.snapshotManager.loadSnapshotMetadata(snapshotId);
      
      this.output.log(this.colorize(`\n🔍 Snapshot Details: ${snapshotId}`, 'header'));
      this.output.log(`Type: ${this.colorize(snapshot.type.toUpperCase(), 'type')}`);
      this.output.log(`Timestamp: ${this.colorize(this.formatTimestamp(snapshot.timestamp), 'date')}`);
      this.output.log(`Git Commit: ${this.colorize(snapshot.gitCommitSha, 'commit')}`);
      
      if (snapshot.description) {
        this.output.log(`Description: ${snapshot.description}`);
      }

      // Show tool call information if available
      if (snapshot.toolCall) {
        this.output.log(this.colorize('\n🔧 Tool Information', 'section'));
        this.output.log(`Tool: ${this.colorize(snapshot.toolCall.toolName, 'tool')}`);
        this.output.log(`Operation: ${this.colorize(snapshot.toolCall.operation, 'operation')}`);
        
        if (snapshot.toolCall.parameters) {
          this.output.log('Parameters:');
          Object.entries(snapshot.toolCall.parameters).forEach(([key, value]) => {
            this.output.log(`  ${key}: ${value}`);
          });
        }
      }

      // Show execution result if available
      if (snapshot.executionResult) {
        this.output.log(this.colorize('\n📋 Execution Result', 'section'));
        this.output.log(`Success: ${this.colorize(snapshot.executionResult.success, snapshot.executionResult.success ? 'success' : 'error')}`);
        this.output.log(`Duration: ${snapshot.executionResult.duration}ms`);
        
        if (snapshot.executionResult.error) {
          this.output.log(`Error: ${this.colorize(snapshot.executionResult.error, 'error')}`);
        }
      }

      // Show performance metrics
      if (snapshot.performance) {
        this.output.log(this.colorize('\n⚡ Performance Metrics', 'section'));
        this.output.log(`Files changed: ${snapshot.performance.filesChanged}`);
        this.output.log(`Snapshot size: ${this.formatFileSize(snapshot.performance.snapshotSizeBytes)}`);
        
        if (snapshot.performance.processingTimeMs) {
          this.output.log(`Processing time: ${snapshot.performance.processingTimeMs}ms`);
        }
      }

      // Show related snapshots if requested
      if (options.showRelated) {
        const related = await this.restoreOps.findRelatedSnapshots(snapshotId);
        if (related.length > 0) {
          this.output.log(this.colorize('\n🔗 Related Snapshots', 'section'));
          related.forEach(rel => {
            this.output.log(`- ${rel.snapshotId} (${rel.type}) - ${this.formatTimestamp(rel.timestamp)}`);
          });
        }
      }

    } catch (error) {
      this.output.error(`Snapshot not found: ${error.message}`);
    }
  }

  /**
   * Preview restoration changes
   */
  async previewRestore(snapshotId, options = {}) {
    try {
      const preview = await this.restoreOps.previewRestore(snapshotId, options);
      
      this.output.log(this.colorize(`\n👁️  Restoration Preview: ${snapshotId}`, 'header'));
      this.output.log(`Snapshot: ${this.colorize(preview.snapshotInfo.description || preview.snapshotInfo.type, 'info')}`);
      this.output.log(`Target commit: ${this.colorize(preview.targetCommit, 'commit')}`);
      this.output.log(`Current commit: ${this.colorize(preview.currentCommit, 'commit')}`);

      // Show changes summary
      this.output.log(this.colorize('\n📝 Changes Summary', 'section'));
      this.output.log(`Total changes: ${this.colorize(preview.summary.totalChanges, 'number')}`);
      this.output.log(`Files modified: ${this.colorize(preview.summary.filesModified, 'number')}`);
      this.output.log(`Files added: ${this.colorize(preview.summary.filesAdded, 'success')}`);
      this.output.log(`Files deleted: ${this.colorize(preview.summary.filesDeleted, 'error')}`);

      // Show detailed file changes
      if (preview.changes.modified.length > 0) {
        this.output.log(this.colorize('\n📝 Modified Files:', 'section'));
        preview.changes.modified.forEach(file => {
          this.output.log(`  ${this.colorize('~', 'warning')} ${file}`);
        });
      }

      if (preview.changes.added.length > 0) {
        this.output.log(this.colorize('\n➕ Added Files:', 'section'));
        preview.changes.added.forEach(file => {
          this.output.log(`  ${this.colorize('+', 'success')} ${file}`);
        });
      }

      if (preview.changes.deleted.length > 0) {
        this.output.log(this.colorize('\n❌ Deleted Files:', 'section'));
        preview.changes.deleted.forEach(file => {
          this.output.log(`  ${this.colorize('-', 'error')} ${file}`);
        });
      }

      // Show safety warnings
      const safetyCheck = await this.restoreOps.performSafetyCheck();
      if (!safetyCheck.safe) {
        this.output.warn(this.colorize('\n⚠️  Safety Warning', 'warning'));
        this.output.warn('Your working tree has uncommitted changes.');
        safetyCheck.recommendations.forEach(rec => {
          this.output.warn(`• ${rec}`);
        });
      }

      if (preview.forceMode) {
        this.output.warn(this.colorize('\n🚨 Force Mode Enabled', 'warning'));
        preview.warnings.forEach(warning => {
          this.output.warn(`• ${warning}`);
        });
      }

    } catch (error) {
      this.output.error(`Failed to preview restoration: ${error.message}`);
    }
  }

  /**
   * Preview file restoration
   */
  async previewFileRestore(snapshotId, filePaths) {
    try {
      const preview = await this.restoreOps.previewFileRestore(snapshotId, filePaths);
      
      this.output.log(this.colorize(`\n👁️  File Restore Preview: ${snapshotId}`, 'header'));
      this.output.log(`Snapshot: ${this.colorize(preview.snapshotInfo.type, 'info')} from ${this.formatTimestamp(preview.snapshotInfo.timestamp)}`);
      
      this.output.log(this.colorize('\n📁 Files to Restore:', 'section'));
      preview.files.forEach(file => {
        this.output.log(`  ${this.colorize('↻', 'info')} ${file.path}`);
      });

    } catch (error) {
      this.output.error(`Failed to preview file restoration: ${error.message}`);
    }
  }

  /**
   * Restore from snapshot
   */
  async restoreFromSnapshot(snapshotId, options = {}) {
    try {
      // Check for confirmation unless explicitly provided
      if (this.interactive && !options.confirm) {
        if (!this.prompt) {
          this.output.warn('Interactive mode requires prompt capability. Use { confirm: true } option to bypass.');
          return;
        }
        
        const confirmed = await this.prompt.confirm(`Are you sure you want to restore from snapshot ${snapshotId}?`);
        if (!confirmed) {
          this.output.info('Restoration cancelled.');
          return;
        }
      }

      this.output.log(this.colorize(`\n🔄 Restoring from snapshot: ${snapshotId}`, 'header'));
      
      const result = await this.restoreOps.restoreFromSnapshot(snapshotId, options);
      
      if (result.success) {
        this.output.info(this.colorize('✅ Snapshot successfully restored!', 'success'));
        this.output.info(`Restored to commit: ${this.colorize(result.restoredCommit, 'commit')}`);
        this.output.info(`Duration: ${result.duration}ms`);
        
        if (result.backupBranch) {
          this.output.info(`Backup branch created: ${this.colorize(result.backupBranch, 'branch')}`);
        }
      }

    } catch (error) {
      this.output.error(`Restoration failed: ${error.message}`);
    }
  }

  /**
   * Restore specific files
   */
  async restoreFiles(snapshotId, filePaths, options = {}) {
    try {
      // Check for confirmation unless explicitly provided
      if (this.interactive && !options.confirm) {
        if (!this.prompt) {
          this.output.warn('Interactive mode requires prompt capability. Use { confirm: true } option to bypass.');
          return;
        }
        
        const confirmed = await this.prompt.confirm(`Restore ${filePaths.length} file(s) from snapshot ${snapshotId}?`);
        if (!confirmed) {
          this.output.info('File restoration cancelled.');
          return;
        }
      }

      this.output.log(this.colorize(`\n📁 Restoring files from snapshot: ${snapshotId}`, 'header'));
      
      const result = await this.restoreOps.restoreFiles(snapshotId, filePaths);
      
      if (result.success) {
        this.output.info(this.colorize('✅ Files restored successfully!', 'success'));
        this.output.info('Files restored:');
        result.restoredFiles.forEach(file => {
          this.output.info(`  ${this.colorize('✓', 'success')} ${file}`);
        });
      }

    } catch (error) {
      this.output.error(`File restoration failed: ${error.message}`);
    }
  }

  /**
   * Show restoration recommendations
   */
  async showRecommendations() {
    try {
      const recommendations = await this.restoreOps.getRestorationRecommendations();
      
      if (recommendations.length === 0) {
        this.output.info('No restoration recommendations available.');
        return;
      }

      this.output.log(this.colorize('\n💡 Restoration Recommendations', 'header'));
      
      // Format recommendations for table display
      const tableData = recommendations.map(rec => ({
        priority: rec.priority.toUpperCase(),
        snapshotId: rec.snapshotId,
        type: rec.type,
        reason: rec.reason
      }));

      this.output.table(tableData);

    } catch (error) {
      this.output.error(`Failed to get recommendations: ${error.message}`);
    }
  }

  /**
   * Interactive snapshot selection
   */
  async selectSnapshotInteractively(options = {}) {
    if (!this.prompt) {
      throw new Error('Interactive selection requires prompt capability');
    }

    const snapshots = await this.snapshotManager.listSnapshots(options);
    
    if (snapshots.length === 0) {
      this.output.info('No snapshots available for selection.');
      return null;
    }

    const choices = snapshots.map(snapshot => ({
      name: `${snapshot.snapshotId} (${snapshot.type}) - ${this.formatTimestamp(snapshot.timestamp)}`,
      value: snapshot.snapshotId
    }));

    return await this.prompt.select({
      message: 'Select a snapshot:',
      choices
    });
  }

  /**
   * Show help information
   */
  async showHelp() {
    this.output.log(this.colorize('\n📚 Lace Snapshot Management CLI', 'header'));
    this.output.log('\nUsage: lace snapshot <command> [options]');
    
    this.output.log(this.colorize('\nCommands:', 'section'));
    this.output.log('  list [--type=TYPE]           List all snapshots, optionally filtered by type');
    this.output.log('  stats                        Show snapshot system statistics');
    this.output.log('  inspect <snapshotId>         Show detailed snapshot information');
    this.output.log('  preview <snapshotId>         Preview restoration changes');
    this.output.log('  restore <snapshotId>         Restore project from snapshot');
    this.output.log('  restore-files <snapshotId>   Restore specific files from snapshot');
    this.output.log('  recommendations              Show restoration recommendations');
    this.output.log('  help                         Show this help information');
    this.output.log('  examples                     Show usage examples');

    this.output.log(this.colorize('\nOptions:', 'section'));
    this.output.log('  --force                      Force operation, bypass safety checks');
    this.output.log('  --backup                     Create backup branch before restoration');
    this.output.log('  --related                    Show related snapshots in inspect');
    this.output.log('  --no-interactive             Disable interactive prompts');

    this.output.log(this.colorize('\nSnapshot Types:', 'section'));
    this.output.log('  checkpoint                   Manual snapshots created by user');
    this.output.log('  pre-tool                     Automatic snapshots before tool execution');
    this.output.log('  post-tool                    Automatic snapshots after tool execution');
  }

  /**
   * Show command examples
   */
  async showExamples() {
    this.output.log(this.colorize('\n📋 Examples', 'header'));
    
    this.output.log(this.colorize('\nListing snapshots:', 'section'));
    this.output.log('  lace snapshot list                    # List all snapshots');
    this.output.log('  lace snapshot list --type=checkpoint  # List only checkpoints');
    this.output.log('  lace snapshot stats                   # Show system statistics');

    this.output.log(this.colorize('\nInspecting snapshots:', 'section'));
    this.output.log('  lace snapshot inspect 2025-06-05T15-30-00-checkpoint');
    this.output.log('  lace snapshot inspect abc123 --related');

    this.output.log(this.colorize('\nRestoring snapshots:', 'section'));
    this.output.log('  lace snapshot preview 2025-06-05T15-30-00-checkpoint');
    this.output.log('  lace snapshot restore 2025-06-05T15-30-00-checkpoint');
    this.output.log('  lace snapshot restore abc123 --force --backup');

    this.output.log(this.colorize('\nFile restoration:', 'section'));
    this.output.log('  lace snapshot restore-files abc123 src/main.js package.json');
    this.output.log('  lace snapshot preview-files abc123 src/');

    this.output.log(this.colorize('\nGetting help:', 'section'));
    this.output.log('  lace snapshot recommendations         # Get restoration suggestions');
    this.output.log('  lace snapshot help                    # Show help information');
  }

  /**
   * Format timestamp for human readability
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString();
    } else if (diffDays === 1) {
      return 'Yesterday ' + date.toLocaleTimeString();
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Format file size for human readability
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const units = ['B', 'KB', 'MB', 'GB'];
    const threshold = 1024;
    
    let unitIndex = 0;
    let size = bytes;
    
    while (size >= threshold && unitIndex < units.length - 1) {
      size /= threshold;
      unitIndex++;
    }
    
    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  }

  /**
   * Colorize text based on type (if colors enabled)
   */
  colorize(text, type) {
    if (!this.colors) return text;
    
    // Simple color mapping (in real implementation would use a library like chalk)
    const colors = {
      header: text,     // Would be bold/cyan
      section: text,    // Would be bold
      success: text,    // Would be green
      error: text,      // Would be red
      warning: text,    // Would be yellow
      info: text,       // Would be blue
      number: text,     // Would be cyan
      date: text,       // Would be gray
      commit: text,     // Would be yellow
      tool: text,       // Would be magenta
      operation: text,  // Would be blue
      type: text,       // Would be green
      branch: text      // Would be cyan
    };
    
    return colors[type] || text;
  }

  /**
   * Get description for snapshot display
   */
  getSnapshotDescription(snapshot) {
    if (snapshot.description) {
      return snapshot.description;
    }
    
    if (snapshot.toolCall) {
      return `${snapshot.toolCall.toolName} ${snapshot.toolCall.operation}`;
    }
    
    return snapshot.type;
  }
}
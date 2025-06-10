// ABOUTME: Handles snapshot restoration and recovery operations for the Lace development safety net
// ABOUTME: Provides project state restoration, selective file recovery, and safety validation

import { promises as fs } from "fs";
import { join } from "path";

export class RestoreOperations {
  constructor(snapshotManager, gitOperations, projectPath) {
    if (!snapshotManager) {
      throw new Error("SnapshotManager is required for restore operations");
    }
    if (!gitOperations) {
      throw new Error("GitOperations is required for restore operations");
    }
    if (!projectPath) {
      throw new Error("Project path is required for restore operations");
    }

    this.snapshotManager = snapshotManager;
    this.gitOps = gitOperations;
    this.projectPath = projectPath;
    this.laceDir = join(projectPath, ".lace");
    this.restoreHistoryPath = join(
      projectPath,
      ".lace",
      "restore-history.json",
    );
  }

  /**
   * List available snapshots with optional filtering
   */
  async listAvailableSnapshots(filters = {}) {
    return await this.snapshotManager.listSnapshots(filters);
  }

  /**
   * Get detailed information about a specific snapshot
   */
  async getSnapshotDetails(snapshotId) {
    return await this.snapshotManager.loadSnapshotMetadata(snapshotId);
  }

  /**
   * Preview what changes a full restore would make
   */
  async previewRestore(snapshotId, options = {}) {
    const snapshot = await this.getSnapshotDetails(snapshotId);
    const currentCommit = await this.gitOps.getCurrentCommit();
    const targetCommit = snapshot.gitCommitSha;

    // Get diff between current and target state
    const changes = await this.gitOps.getDiffFiles(currentCommit, targetCommit);

    const preview = {
      snapshotId,
      targetCommit,
      currentCommit,
      changes,
      summary: {
        filesModified: changes.modified.length,
        filesAdded: changes.added.length,
        filesDeleted: changes.deleted.length,
        totalChanges: changes.totalChanges,
      },
      snapshotInfo: {
        type: snapshot.type,
        timestamp: snapshot.timestamp,
        description: snapshot.description || `${snapshot.type} snapshot`,
      },
    };

    if (options.force) {
      preview.forceMode = true;
      preview.warnings = [
        "Force mode will discard any uncommitted changes",
        "This operation cannot be undone without proper backups",
      ];
    }

    return preview;
  }

  /**
   * Preview selective file restoration
   */
  async previewFileRestore(snapshotId, filePaths) {
    const snapshot = await this.getSnapshotDetails(snapshotId);

    // Validate files exist in snapshot (this would normally check git)
    for (const filePath of filePaths) {
      try {
        await this.gitOps.restoreFiles(snapshot.gitCommitSha, [filePath]);
      } catch (error) {
        throw new Error(`File not found in snapshot: ${filePath}`);
      }
    }

    return {
      snapshotId,
      files: filePaths.map((path) => ({
        path,
        status: "will_be_restored",
      })),
      snapshotInfo: {
        type: snapshot.type,
        timestamp: snapshot.timestamp,
        commit: snapshot.gitCommitSha,
      },
    };
  }

  /**
   * Perform safety checks before restoration
   */
  async performSafetyCheck() {
    const workingTreeStatus = await this.gitOps.getWorkingTreeStatus();
    const hasChanges = workingTreeStatus.hasChanges;

    const recommendations = [];
    if (hasChanges) {
      recommendations.push(
        "Commit or stash your current changes before restoring",
      );
      recommendations.push(
        "Consider creating a backup branch of your current state",
      );
      recommendations.push(
        "Use --force flag only if you are certain about discarding changes",
      );
    }

    return {
      hasWorkingTreeChanges: hasChanges,
      workingTreeStatus,
      recommendations,
      safe: !hasChanges,
    };
  }

  /**
   * Restore complete project state from a snapshot
   */
  async restoreFromSnapshot(snapshotId, options = {}) {
    const snapshot = await this.getSnapshotDetails(snapshotId);
    const startTime = Date.now();

    // Perform safety check unless force mode
    if (!options.force) {
      const safetyCheck = await this.performSafetyCheck();
      if (!safetyCheck.safe) {
        throw new Error(
          "Working tree has uncommitted changes. Use { force: true } to override or commit/stash changes first.",
        );
      }
    }

    let backupBranch = null;

    try {
      // Create backup branch if requested
      if (options.createBackup) {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        backupBranch = `backup-${timestamp}`;
        await this.gitOps.createBranch(backupBranch);
      }

      // Perform the restore
      const restoreResult = await this.gitOps.checkout(snapshot.gitCommitSha);

      const restorationRecord = {
        snapshotId,
        timestamp: new Date().toISOString(),
        type: "full_restore",
        fromCommit: await this.gitOps.getCurrentCommit(),
        toCommit: snapshot.gitCommitSha,
        backupBranch,
        duration: Date.now() - startTime,
        success: true,
      };

      // Record restoration in history
      await this.recordRestoration(restorationRecord);

      return {
        success: true,
        snapshotId,
        restoredCommit: snapshot.gitCommitSha,
        backupBranch,
        timestamp: restorationRecord.timestamp,
        duration: restorationRecord.duration,
      };
    } catch (error) {
      throw new Error(`Snapshot restoration failed: ${error.message}`);
    }
  }

  /**
   * Restore specific files from a snapshot
   */
  async restoreFiles(snapshotId, filePaths) {
    const snapshot = await this.getSnapshotDetails(snapshotId);

    try {
      const restoreResult = await this.gitOps.restoreFiles(
        snapshot.gitCommitSha,
        filePaths,
      );

      const restorationRecord = {
        snapshotId,
        timestamp: new Date().toISOString(),
        type: "file_restore",
        files: filePaths,
        fromCommit: snapshot.gitCommitSha,
        success: true,
      };

      await this.recordRestoration(restorationRecord);

      return {
        success: true,
        snapshotId,
        restoredFiles: restoreResult.restoredFiles,
        timestamp: restorationRecord.timestamp,
      };
    } catch (error) {
      throw new Error(`File restoration failed: ${error.message}`);
    }
  }

  /**
   * Get restoration history
   */
  async getRestorationHistory() {
    try {
      const historyData = await fs.readFile(this.restoreHistoryPath, "utf8");
      const history = JSON.parse(historyData);
      return history.operations || [];
    } catch (error) {
      // Return empty history if file doesn't exist
      return [];
    }
  }

  /**
   * Record a restoration operation
   */
  async recordRestoration(operation) {
    let history = { operations: [] };

    try {
      const existingData = await fs.readFile(this.restoreHistoryPath, "utf8");
      history = JSON.parse(existingData);
    } catch (error) {
      // File doesn't exist, use empty history
    }

    history.operations.unshift(operation);

    // Keep only last 100 operations
    if (history.operations.length > 100) {
      history.operations = history.operations.slice(0, 100);
    }

    history.lastUpdated = new Date().toISOString();

    await fs.mkdir(this.laceDir, { recursive: true });
    await fs.writeFile(
      this.restoreHistoryPath,
      JSON.stringify(history, null, 2),
    );
  }

  /**
   * Rollback the last restoration operation
   */
  async rollbackLastRestore() {
    const history = await this.getRestorationHistory();

    if (history.length === 0) {
      throw new Error("No restoration operations to rollback");
    }

    const lastRestore = history[0];

    if (lastRestore.type !== "full_restore") {
      throw new Error("Can only rollback full restoration operations");
    }

    // Restore to the commit we were at before the last restoration
    const rollbackResult = await this.gitOps.checkout(lastRestore.fromCommit);

    const rollbackRecord = {
      snapshotId: null,
      timestamp: new Date().toISOString(),
      type: "rollback",
      rolledBackOperation: lastRestore.snapshotId,
      fromCommit: lastRestore.toCommit,
      toCommit: lastRestore.fromCommit,
      success: true,
    };

    await this.recordRestoration(rollbackRecord);

    return {
      success: true,
      restoredCommit: lastRestore.fromCommit,
      rollbackTimestamp: rollbackRecord.timestamp,
      rolledBackOperation: lastRestore.snapshotId,
    };
  }

  /**
   * Find snapshots related to a given snapshot (e.g., pre/post tool pairs)
   */
  async findRelatedSnapshots(snapshotId) {
    const targetSnapshot = await this.getSnapshotDetails(snapshotId);
    const allSnapshots = await this.listAvailableSnapshots();

    const related = [];

    // For tool snapshots, find the corresponding pre/post pair
    if (targetSnapshot.toolCall && targetSnapshot.toolCall.executionId) {
      const executionId = targetSnapshot.toolCall.executionId;

      for (const snapshot of allSnapshots) {
        if (
          snapshot.snapshotId !== snapshotId &&
          snapshot.toolCall &&
          snapshot.toolCall.executionId === executionId
        ) {
          const fullSnapshot = await this.getSnapshotDetails(
            snapshot.snapshotId,
          );
          related.push(fullSnapshot);
        }
      }
    }

    // Find snapshots from similar timeframe
    const targetTime = new Date(targetSnapshot.timestamp);
    const timeWindow = 5 * 60 * 1000; // 5 minutes

    for (const snapshot of allSnapshots) {
      if (snapshot.snapshotId !== snapshotId) {
        const snapshotTime = new Date(snapshot.timestamp);
        const timeDiff = Math.abs(targetTime - snapshotTime);

        if (timeDiff <= timeWindow) {
          const fullSnapshot = await this.getSnapshotDetails(
            snapshot.snapshotId,
          );
          if (!related.find((r) => r.snapshotId === fullSnapshot.snapshotId)) {
            related.push(fullSnapshot);
          }
        }
      }
    }

    return related;
  }

  /**
   * Get restoration recommendations based on current state and available snapshots
   */
  async getRestorationRecommendations() {
    const snapshots = await this.listAvailableSnapshots();
    const recommendations = [];

    // Most recent checkpoint
    const checkpoints = snapshots.filter((s) => s.type === "checkpoint");
    if (checkpoints.length > 0) {
      recommendations.push({
        snapshotId: checkpoints[0].snapshotId,
        reason: "Most recent manual checkpoint",
        priority: "high",
        type: "checkpoint",
      });
    }

    // Recent successful tool operations
    const recentToolSnapshots = snapshots
      .filter((s) => s.type === "post-tool")
      .slice(0, 3);

    for (const snapshot of recentToolSnapshots) {
      recommendations.push({
        snapshotId: snapshot.snapshotId,
        reason: `Recent successful ${snapshot.toolCall?.toolName || "tool"} operation`,
        priority: "medium",
        type: "tool-operation",
      });
    }

    // Snapshots from earlier today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todaySnapshots = snapshots.filter((s) => {
      const snapshotDate = new Date(s.timestamp);
      return snapshotDate >= today;
    });

    if (todaySnapshots.length > 0) {
      const oldestToday = todaySnapshots[todaySnapshots.length - 1];
      recommendations.push({
        snapshotId: oldestToday.snapshotId,
        reason: "Start of today's work session",
        priority: "low",
        type: "session-start",
      });
    }

    return recommendations;
  }
}

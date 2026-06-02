// ABOUTME: ShimContainerRuntime — drives the sen-docker shim via the closed `spawn` verb instead of `docker create` (PRI-2012 Root A).
// ABOUTME: create() emits `<dockerBin> spawn <persona> <parent> <child> <jobId>`; start()/netns are no-ops (spawn is atomic); other verbs inherit DockerContainerRuntime (dockerBin = the sen-docker-client wrapper, which forwards + the shim gates).

import { execFile } from 'child_process';
import { promisify } from 'util';
import { logger } from '@lace/agent/utils/logger';
import { DockerContainerRuntime } from './docker-container';
import { ContainerConfig, ContainerError, ContainerInfo, ContainerState } from './types';

const execFileAsync = promisify(execFile);

// v1: lace's per-run jobId isn't available at binding-build time (the binding is
// projected before the job is created), so synthesize a deterministic, valid job
// id from the session for the shim's audit label + register_runtime. Exact
// lace-jobId threading is a follow-up — jobId is audit metadata; the security
// invariants are persona (closed enum) + source-IP attribution, not jobId.
function synthesizeJobId(sessionId: string): string {
  const short = sessionId.replace(/^sess_/, '').slice(0, 24) || 'unknown';
  return `job_${short}`;
}

export class ShimContainerRuntime extends DockerContainerRuntime {
  // The shim's `spawn` is atomic (create + start + netns-init + identity
  // register), so create() emits the closed verb and start()/netns become no-ops.
  override async create(config: ContainerConfig): Promise<string> {
    const requestedName = this.resolveContainerName(config);
    const persona = config.persona;
    if (!persona) {
      throw new ContainerError(
        'ShimContainerRuntime.create requires config.persona (selector field)',
        requestedName
      );
    }
    const parentSession = config.parentSession ?? '';
    const childSession = config.childSession ?? '';
    const jobId = config.jobId ?? synthesizeJobId(childSession || parentSession);

    logger.info('Spawning persona via sen-docker shim', {
      persona,
      parentSession,
      childSession: childSession || undefined,
      jobId,
    });

    let name: string;
    try {
      const { stdout } = await execFileAsync(this.dockerBin, [
        'spawn',
        persona,
        parentSession,
        childSession,
        jobId,
      ]);
      // The shim prints the daemon-side container name on success.
      name = stdout.trim() || requestedName;
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string }).stderr ?? '';
      const message = error instanceof Error ? error.message : String(error);
      throw new ContainerError(
        `shim spawn failed for persona '${persona}': ${stderr || message}`,
        requestedName,
        error instanceof Error ? error : undefined
      );
    }

    // spawn already created + started + netns-init'd; record as running so the
    // no-op start() leaves state correct and exec/inspect work against it.
    const info: ContainerInfo = { id: name, state: 'running', mounts: config.mounts };
    this.containers.set(name, info);
    this.configs.set(name, { ...config, id: name });
    this.registerMounts(name, config);
    return name;
  }

  // No-op: the shim's spawn already started the container + ran netns-init.
  override async start(containerId: string): Promise<void> {
    const info = this.containers.get(containerId);
    if (info) info.state = 'running';
  }

  // Adoption is handled inside the shim's spawn (persona-only adopt + netns
  // re-assert), which is idempotent — re-running it lets a restarted parent
  // re-assert a persistent box's route without recreating it.
  override async adopt(config: ContainerConfig, _state: ContainerState): Promise<void> {
    await this.create(config);
  }
}

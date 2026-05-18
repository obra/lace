// ABOUTME: Constructs a platform-appropriate ContainerManager
// ABOUTME: Linux -> Docker, macOS -> Apple. Unsupported platforms -> null.

import { logger } from '@lace/agent/utils/logger';
import { ContainerManager } from './container-manager';
import { DockerContainerRuntime } from './docker-container';
import { AppleContainerRuntime } from './apple-container';
import type { ContainerRuntime } from './types';

export function createDefaultContainerManager(
  platform: NodeJS.Platform = process.platform
): ContainerManager | null {
  let runtime: ContainerRuntime | null = null;

  if (platform === 'linux') {
    runtime = new DockerContainerRuntime();
  } else if (platform === 'darwin') {
    runtime = new AppleContainerRuntime();
  } else {
    logger.debug('containers.manager_factory.unsupported_platform', { platform });
    return null;
  }

  return new ContainerManager(runtime);
}

// ABOUTME: Server instrumentation and initialization for Next.js web app
// ABOUTME: Initializes global persistence during server startup

import { initializePersistence } from '~/persistence/database';
import { logger } from '~/utils/logger';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only initialize on the Node.js runtime (server-side)
    try {
      initializePersistence();
      logger.info('Global persistence initialized for Next.js web app');
    } catch (error) {
      logger.error('Failed to initialize persistence in web app:', error);
      throw error;
    }
  }
}

// ABOUTME: Server instrumentation and initialization for Next.js web app
// ABOUTME: Initializes global persistence during server startup

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only initialize on the Node.js runtime (server-side)
    try {
      const { initializePersistence } = await import('~/persistence/database');
      const { logger } = await import('~/utils/logger');
      initializePersistence();
      logger.info('Global persistence initialized for Next.js web app');
    } catch (error) {
      const { logger } = await import('~/utils/logger');
      logger.error('Failed to initialize persistence in web app:', error);
      throw error;
    }
  }
}

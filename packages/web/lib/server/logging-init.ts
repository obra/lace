// ABOUTME: Server-side logging initialization for Next.js web application
// ABOUTME: Configures the core logger with environment variables and initializes traffic logging if enabled

import { logger } from '@/lib/server/lace-imports';

// Also configure the core logger that providers use
// This is the same logger instance, but we need to ensure it's configured

// Initialize core logger with environment variables
const logLevel = process.env.LACE_LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | undefined;
const logFile = process.env.LACE_LOG_FILE;
const useStderr = process.env.LACE_LOG_STDERR === 'true';

if (logLevel || logFile || useStderr) {
  logger.configure(logLevel || 'info', logFile, useStderr);
  logger.info('Next.js logging initialized', {
    logLevel: logLevel || 'info',
    logFile: logFile || 'none',
    useStderr,
    pid: process.pid,
    runtime: 'nextjs-server',
  });

  // Test that debug logging is working
  logger.debug('Debug logging test from Next.js initialization');

  // Force a provider import to test if it logs
  setTimeout(() => {
    logger.debug('Testing provider logging setup...');
  }, 1000);
}

// Initialize HAR recording if configured
const harFile = process.env.LACE_DEBUG_HAR_FILE;
if (harFile) {
  // Dynamically import to avoid loading traffic logging if not needed
  import('@lace/core/utils/traffic-logger')
    .then(({ enableTrafficLogging }) => {
      return enableTrafficLogging(harFile);
    })
    .then(() => {
      logger.info('HAR recording enabled', { harFile });
    })
    .catch((error: unknown) => {
      logger.error('Failed to enable HAR recording', { error, harFile });
    });
}

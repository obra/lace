// ABOUTME: Web data directory initialization for web app startup
// ABOUTME: Ensures web-owned data directory exists before any database operations
import { ensureLaceWebDir } from './web-data-dir';

// Initialize web data dir at startup
try {
  const _webDir = ensureLaceWebDir();
} catch (error) {
  console.error('Failed to initialize LACE_WEB_DIR:', error);
  // Don't throw - let the app start but log the error
}

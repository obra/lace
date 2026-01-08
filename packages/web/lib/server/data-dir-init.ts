// ABOUTME: LACE_DIR initialization for web app startup
// ABOUTME: Ensures LACE configuration directory exists before any database operations
import { ensureLaceDir } from './lace-dir';
import { ensureLaceWebDir } from './web-data-dir';

// Initialize LACE_DIR at startup
try {
  const _laceDir = ensureLaceDir();
  const _webDir = ensureLaceWebDir();
} catch (error) {
  console.error('Failed to initialize LACE_DIR:', error);
  // Don't throw - let the app start but log the error
}

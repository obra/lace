// ABOUTME: LACE_DIR initialization for web app startup
// ABOUTME: Ensures LACE configuration directory exists before any database operations

import 'server-only';
import { ensureLaceDir } from '@/lib/server/lace-imports';

// Initialize LACE_DIR at startup
try {
  const _laceDir = ensureLaceDir();
} catch (error) {
  console.error('Failed to initialize LACE_DIR:', error);
  // Don't throw - let the app start but log the error
}

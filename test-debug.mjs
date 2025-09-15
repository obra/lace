// Quick debug script to test the release notes service directly
import { checkReleaseNotesStatus } from './packages/web/lib/services/release-notes-service.ts';

console.log('Testing service directly...');

try {
  const result = await checkReleaseNotesStatus('different-hash');
  console.log('Service result:', result);
} catch (error) {
  console.error('Service error:', error);
}
// Quick debug script to test race condition defenses step by step
console.log('=== Testing Database Constraint ===');

import { setupTestPersistence, teardownTestPersistence } from './dist/test-utils/persistence-helper.js';
import { ThreadManager } from './dist/threads/thread-manager.js';

const persistence = setupTestPersistence();
const threadManager = new ThreadManager();

const threadId = threadManager.generateThreadId();
threadManager.createThread(threadId);

console.log('1. Created thread:', threadId);

// First approval should succeed
try {
  const event1 = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
    toolCallId: 'test-tool-123',
    decision: 'approve'
  });
  console.log('2. First approval succeeded:', event1.id);
} catch (error) {
  console.log('2. First approval failed:', error.message);
}

// Second approval should be ignored due to constraint
try {
  const event2 = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', {
    toolCallId: 'test-tool-123', 
    decision: 'approve'
  });
  console.log('3. Second approval succeeded (unexpected):', event2.id);
} catch (error) {
  console.log('3. Second approval failed (expected):', error.message);
}

// Check how many events are actually in the database
const events = threadManager.getEvents(threadId);
const approvalEvents = events.filter(e => e.type === 'TOOL_APPROVAL_RESPONSE');
console.log('4. Total approval events in database:', approvalEvents.length);

threadManager.close();
teardownTestPersistence();
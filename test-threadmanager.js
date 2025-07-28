// Test ThreadManager.addEvent vs raw SQL to find the difference
import { setupTestPersistence, teardownTestPersistence } from './dist/test-utils/persistence-helper.js';
import { ThreadManager } from './dist/threads/thread-manager.js';
import { getPersistence } from './dist/persistence/database.js';

console.log('=== Comparing ThreadManager vs Raw SQL ===');

const persistence = setupTestPersistence();
const threadManager = new ThreadManager();
const db = persistence.database;

const threadId = threadManager.generateThreadId();
threadManager.createThread(threadId);

console.log('1. Created thread:', threadId);

// Test with ThreadManager
const approvalData = {
  toolCallId: 'tool-xyz',
  decision: 'approve'
};

try {
  const event1 = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', approvalData);
  console.log('2. ThreadManager first approval:', event1.id);
  console.log('   Event data:', JSON.stringify(event1.data));
} catch (error) {
  console.log('2. ERROR with ThreadManager first approval:', error.message);
}

try {
  const event2 = threadManager.addEvent(threadId, 'TOOL_APPROVAL_RESPONSE', approvalData);
  console.log('3. ThreadManager second approval (SHOULD FAIL):', event2.id);
  console.log('   Event data:', JSON.stringify(event2.data));
} catch (error) {
  console.log('3. ThreadManager second approval correctly failed:', error.message);
}

// Check what's in the database
const events = db.prepare(`
  SELECT id, type, json_extract(data, '$.toolCallId') as toolCallId, data
  FROM events 
  WHERE thread_id = ? AND type = 'TOOL_APPROVAL_RESPONSE'
  ORDER BY timestamp
`).all(threadId);

console.log('4. Events in database:');
events.forEach((evt, i) => {
  console.log(`   ${i + 1}. ID: ${evt.id}, toolCallId: ${evt.toolCallId}`);
  console.log(`      Raw data: ${evt.data}`);
});

threadManager.close();
teardownTestPersistence();
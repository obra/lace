// Test the database constraint with raw SQL
import { setupTestPersistence, teardownTestPersistence } from './dist/test-utils/persistence-helper.js';
import { getPersistence } from './dist/persistence/database.js';

console.log('=== Testing Database Constraint with Raw SQL ===');

const persistence = setupTestPersistence();
const db = persistence.database;

if (!db) {
  console.log('ERROR: Database not initialized');
  process.exit(1);
}

const threadId = 'test-thread-123';

// Create thread first
db.prepare(`
  INSERT INTO threads (id, created_at, updated_at)
  VALUES (?, ?, ?)
`).run(threadId, new Date().toISOString(), new Date().toISOString());

console.log('1. Created thread:', threadId);

// First approval event
const event1Data = { toolCallId: 'tool-abc', decision: 'approve' };
try {
  db.prepare(`
    INSERT INTO events (id, thread_id, type, timestamp, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'evt1',
    threadId,
    'TOOL_APPROVAL_RESPONSE',
    new Date().toISOString(),
    JSON.stringify(event1Data)
  );
  console.log('2. First approval inserted successfully');
} catch (error) {
  console.log('2. ERROR inserting first approval:', error.message);
}

// Second approval event (should fail due to constraint)
const event2Data = { toolCallId: 'tool-abc', decision: 'approve' };
try {
  db.prepare(`
    INSERT INTO events (id, thread_id, type, timestamp, data)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    'evt2',
    threadId,
    'TOOL_APPROVAL_RESPONSE',
    new Date().toISOString(),
    JSON.stringify(event2Data)
  );
  console.log('3. Second approval inserted (SHOULD HAVE FAILED)');
} catch (error) {
  console.log('3. Second approval correctly failed:', error.message);
}

// Check what's actually in the database
const approvals = db.prepare(`
  SELECT id, json_extract(data, '$.toolCallId') as toolCallId 
  FROM events 
  WHERE thread_id = ? AND type = 'TOOL_APPROVAL_RESPONSE'
`).all(threadId);

console.log('4. Approval events in database:', approvals);

teardownTestPersistence();
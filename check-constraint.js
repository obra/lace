// Debug script to check if database constraint exists
import { setupTestPersistence, teardownTestPersistence } from './dist/test-utils/persistence-helper.js';
import { getPersistence } from './dist/persistence/database.js';

console.log('=== Checking Database Constraint ===');

const persistence = setupTestPersistence();
const db = persistence.database;

if (!db) {
  console.log('ERROR: Database not initialized');
  process.exit(1);
}

// Check schema version
const versionResult = db.prepare('SELECT MAX(version) as version FROM schema_version').get();
console.log('1. Current schema version:', versionResult.version);

// Check if the unique index exists
const indexResult = db.prepare(`
  SELECT name, sql FROM sqlite_master 
  WHERE type = 'index' AND name = 'idx_unique_tool_approval'
`).get();

if (indexResult) {
  console.log('2. Unique constraint exists:');
  console.log('   Name:', indexResult.name);
  console.log('   SQL:', indexResult.sql);
} else {
  console.log('2. ERROR: Unique constraint NOT FOUND');
}

// Check all indexes on events table
const allIndexes = db.prepare(`
  SELECT name, sql FROM sqlite_master 
  WHERE type = 'index' AND tbl_name = 'events'
`).all();

console.log('3. All indexes on events table:');
allIndexes.forEach((idx, i) => {
  console.log(`   ${i + 1}. ${idx.name}: ${idx.sql}`);
});

teardownTestPersistence();
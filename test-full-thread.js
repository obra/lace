// Quick test to see what happens when we process the FULL original thread
const fs = require('fs');

// Read the full thread events
const fullThreadData = fs.readFileSync('/tmp/full_thread_events.json', 'utf8');
const events = JSON.parse(fullThreadData);

console.log(`Total events: ${events.length}`);

// Count tool calls and results
const toolCalls = events.filter(e => e.type === 'TOOL_CALL');
const toolResults = events.filter(e => e.type === 'TOOL_RESULT');

console.log(`Tool calls: ${toolCalls.length}`);
console.log(`Tool results: ${toolResults.length}`);

// Check for the specific problematic ID
const problematicId = 'toolu_012RDexnDVgu6QthBGZZ45RH';
const callWithId = toolCalls.find(tc => tc.data.id === problematicId);
const resultWithId = toolResults.find(tr => tr.data.id === problematicId);

console.log(`Call with ${problematicId}:`, !!callWithId);
console.log(`Result with ${problematicId}:`, !!resultWithId);

if (callWithId) {
  console.log('Call timestamp:', callWithId.timestamp);
}
if (resultWithId) {
  console.log('Result timestamp:', resultWithId.timestamp);
}

// Check for any mismatched IDs
const callIds = new Set(toolCalls.map(tc => tc.data.id));
const resultIds = new Set(toolResults.map(tr => tr.data.id));

const orphanedResults = [...resultIds].filter(id => !callIds.has(id));
const orphanedCalls = [...callIds].filter(id => !resultIds.has(id));

console.log('Orphaned results:', orphanedResults);
console.log('Orphaned calls:', orphanedCalls);
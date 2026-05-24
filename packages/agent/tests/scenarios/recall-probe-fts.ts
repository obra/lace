import Database from 'better-sqlite3';
const db = new Database(':memory:');
db.exec(`CREATE VIRTUAL TABLE events USING fts5(event_id UNINDEXED, content);`);
db.prepare(`INSERT INTO events VALUES (?, ?)`).run('e1', 'hello world');
db.prepare(`INSERT INTO events VALUES (?, ?)`).run('e2', 'foo bar baz');

const queries = [
  'hello', // normal
  'hello AND world', // FTS operator
  'NEAR(hello world, 3)', // NEAR operator
  '"unclosed quote', // unclosed phrase
  'hello*', // wildcard
  '-foo', // negation
  'event_id:e1', // column filter
  '', // empty
  '   ', // whitespace
  'AND', // bare operator
  '))) OR (1=1', // SQL injection style
  "'; DROP TABLE events;", // SQL inject (bound param so safe but maybe FTS error)
  '*', // bare wildcard
  '!@#$%', // garbage
  'a OR b OR c OR d OR e OR f', // big disjunction
];

for (const q of queries) {
  try {
    const rows = db.prepare(`SELECT event_id FROM events WHERE content MATCH ?`).all(q);
    console.log(JSON.stringify({ query: q, count: rows.length, ok: true }));
  } catch (err) {
    console.log(JSON.stringify({ query: q, error: (err as Error).message }));
  }
}
db.close();

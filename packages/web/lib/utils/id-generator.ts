// ABOUTME: ID generation utility for sessions and projects
// ABOUTME: Generates unique IDs with timestamp and random components

export function generateId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substring(2, 8);
  return `lace_${date}_${random}`;
}

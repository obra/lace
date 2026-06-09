// ABOUTME: Shared helpers for the exec-backed container fs/network runtimes.
// ABOUTME: Synthesizes Node-shaped fs errors from a brokered exec's exit+stderr.

/** Map a non-zero `docker exec` of a stock binary back to the Node `error.code`
 * the file tools branch on (file_read/file_write/file_find inspect `.code`). The
 * helper got these free from node:fs; over exec we reconstruct from stderr. */
export function nodeErrorFromExec(
  exitCode: number,
  stderr: string,
  op: string,
  path: string
): Error {
  const s = stderr.toLowerCase();
  let code: string | undefined;
  if (s.includes('no such file or directory')) code = 'ENOENT';
  else if (s.includes('read-only file system')) code = 'EACCES';
  else if (s.includes('permission denied')) code = 'EACCES';
  else if (s.includes('is a directory')) code = 'EISDIR';
  else if (s.includes('not a directory')) code = 'ENOTDIR';
  else if (s.includes('no space left')) code = 'ENOSPC';
  else if (s.includes('file exists')) code = 'EEXIST';
  const message = stderr.trim() || `${op} failed (exit ${exitCode}) for ${path}`;
  const err = new Error(message);
  if (code) (err as NodeJS.ErrnoException).code = code;
  return err;
}

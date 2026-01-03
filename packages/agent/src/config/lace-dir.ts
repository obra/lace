import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function getLaceDir(): string {
  return process.env.LACE_DIR || path.join(os.homedir(), '.lace');
}

export function ensureLaceDir(): string {
  const laceDir = getLaceDir();

  try {
    if (!fs.existsSync(laceDir)) fs.mkdirSync(laceDir, { recursive: true });
    return laceDir;
  } catch (error) {
    throw new Error(
      `Failed to create Lace configuration directory at ${laceDir}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

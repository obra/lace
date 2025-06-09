import { existsSync } from 'fs';
import { resolve } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const sync = (request, options) => {
  const basePath = resolve(options.basedir, request);
  
  // If request ends with .js, check if .js exists, then try .ts
  if (request.endsWith('.js')) {
    if (existsSync(basePath)) return basePath;
    
    const withoutExt = request.slice(0, -3);
    const tsPath = resolve(options.basedir, withoutExt + '.ts');
    if (existsSync(tsPath)) return tsPath;
  }
  
  // For extensionless imports, try common extensions
  if (!request.includes('.')) {
    const extensions = ['.ts', '.tsx', '.js', '.jsx'];
    for (const ext of extensions) {
      const fullPath = basePath + ext;
      if (existsSync(fullPath)) return fullPath;
    }
  }
  
  // Fall back to default resolution
  try {
    return require.resolve(request, { paths: [options.basedir] });
  } catch {
    return null;
  }
};
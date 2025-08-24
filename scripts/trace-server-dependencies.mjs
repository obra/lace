// ABOUTME: Uses @vercel/nft to trace server-custom.ts dependencies for Next.js build integration
// ABOUTME: Generates trace data that gets integrated with outputFileTracingIncludes

import { nodeFileTrace } from '@vercel/nft';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function traceServerDependencies() {
  const projectRoot = path.resolve(__dirname, '..');
  const serverFile = path.join(projectRoot, 'packages/web/server-custom.ts');
  
  console.log('🔍 Tracing dependencies for server-custom.ts...');
  console.log(`   Server file: ${serverFile}`);
  console.log(`   Project root: ${projectRoot}`);
  
  try {
    // Create a temporary file that has static imports to force nft to trace them
    const webDir = path.join(projectRoot, 'packages/web');
    const tempFile = path.join(webDir, 'temp-trace-imports.mjs');
    const tempContent = `
// Temporary file to force nft to trace dynamic imports from server-custom.ts
import 'open';
import 'default-browser';
import 'bundle-name';
import 'define-lazy-prop';
import 'is-inside-container';
import 'is-docker';
import 'is-wsl';
import 'wsl-utils';
    `.trim();
    
    await fs.writeFile(tempFile, tempContent);
    
    console.log('📋 Created temporary trace file with static imports');
    console.log(`   Temp file: ${tempFile}`);
    
    // Use the same nft configuration as Next.js does
    console.log(`🔍 Tracing from base: ${projectRoot}`);
    console.log(`   Process CWD: ${webDir}`);
    
    const result = await nodeFileTrace([serverFile, tempFile], {
      base: projectRoot,
      processCwd: projectRoot, // Use root to find hoisted deps
      mixedModules: true,
      async readFile(p) {
        try {
          return await fs.readFile(p, 'utf8');
        } catch (e) {
          if (e.code === 'ENOENT' || e.code === 'EISDIR') {
            return '';
          }
          throw e;
        }
      },
      async readlink(p) {
        try {
          return await fs.readlink(p);
        } catch (e) {
          if (e.code === 'EINVAL' || e.code === 'ENOENT' || e.code === 'UNKNOWN') {
            return null;
          }
          throw e;
        }
      },
      async stat(p) {
        try {
          return await fs.stat(p);
        } catch (e) {
          if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
            return null;
          }
          throw e;
        }
      },
      ignore(p) {
        // Ignore Next.js build artifacts and other noise
        if (p.includes('.next/') || p.includes('node_modules/next/dist/')) {
          return true;
        }
        return false;
      }
    });

    const tracedFiles = Array.from(result.fileList);
    
    // Clean up temp file
    await fs.unlink(tempFile).catch(() => {});
    
    console.log(`✅ Traced ${tracedFiles.length} dependencies`);
    
    // Group dependencies by their nature to understand what we found
    const deps = {
      'open package': tracedFiles.filter(f => f.includes('/open/')),
      'is-docker': tracedFiles.filter(f => f.includes('/is-docker/')),
      'is-inside-container': tracedFiles.filter(f => f.includes('/is-inside-container/')),
      'other dependencies': tracedFiles.filter(f => 
        !f.includes('/open/') && 
        !f.includes('/is-docker/') && 
        !f.includes('/is-inside-container/') &&
        f.includes('/node_modules/')
      )
    };
    
    console.log('\n📋 Dependency breakdown:');
    Object.entries(deps).forEach(([category, files]) => {
      if (files.length > 0) {
        console.log(`   ${category}: ${files.length} files`);
        if (category === 'is-docker') {
          console.log(`      Found is-docker: ${files.map(f => path.basename(f)).join(', ')}`);
        }
      }
    });
    
    // Convert to the format expected by outputFileTracingIncludes
    // Transform packages/web/node_modules/... to node_modules/... for standalone build
    const includePatterns = tracedFiles
      .filter(file => file.includes('/node_modules/'))
      .map(file => file.replace('packages/web/node_modules/', 'node_modules/'))
      .map(file => file.replace(/\\/g, '/'));
    
    console.log('\n📝 Generated include patterns:');
    console.log(`   Total patterns: ${includePatterns.length}`);
    console.log(`   Sample patterns: ${includePatterns.slice(0, 3).join(', ')}`);
    
    // Manually check for packages in monorepo structure since NFT might not find hoisted deps
    const openExists = await fs.access(path.join(projectRoot, 'node_modules/open/package.json')).then(() => true).catch(() => false);
    const isDockerExists = await fs.access(path.join(projectRoot, 'node_modules/is-docker/package.json')).then(() => true).catch(() => false);
    
    // Add manual patterns for hoisted dependencies
    if (openExists && !includePatterns.some(f => f.includes('/open/'))) {
      includePatterns.push('node_modules/open/**/*');
      deps['open package'].push('node_modules/open/package.json');
    }
    if (isDockerExists && !includePatterns.some(f => f.includes('/is-docker/'))) {
      includePatterns.push('node_modules/is-docker/**/*');
      deps['is-docker'].push('node_modules/is-docker/package.json', 'node_modules/is-docker/index.js');
    }

    // Write the trace results to a file that our build process can use
    const traceOutput = {
      timestamp: new Date().toISOString(),
      serverFile: path.relative(projectRoot, serverFile),
      tracedFiles: includePatterns, // Use corrected paths
      summary: {
        totalFiles: tracedFiles.length,
        nodeModulesFiles: includePatterns.length,
        hasIsDocker: deps['is-docker']?.length > 0,
        hasOpen: deps['open package']?.length > 0
      }
    };
    
    const outputPath = path.join(projectRoot, 'packages/web/server-dependencies.json');
    await fs.writeFile(outputPath, JSON.stringify(traceOutput, null, 2));
    
    console.log(`\n💾 Trace results saved to: ${path.relative(projectRoot, outputPath)}`);
    console.log(`   is-docker found: ${traceOutput.summary.hasIsDocker ? '✅' : '❌'}`);
    console.log(`   open package found: ${traceOutput.summary.hasOpen ? '✅' : '❌'}`);
    
    return traceOutput;
    
  } catch (error) {
    console.error('❌ Failed to trace dependencies:', error);
    throw error;
  }
}

// Run if called directly
traceServerDependencies().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

export { traceServerDependencies };
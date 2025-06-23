#!/usr/bin/env node

// Quick test script to see what the BBC homepage looks like after our processing
import TurndownService from 'turndown';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_'
});

function isTextContent(contentType) {
  return contentType.startsWith('text/') || 
         contentType === 'application/json' ||
         contentType === 'application/xml' ||
         contentType === 'application/javascript';
}

function processContent(buffer, contentType) {
  const cleanType = contentType.split(';')[0].trim().toLowerCase();
  
  if (!isTextContent(cleanType)) {
    return `Binary content detected (${cleanType})\nSize: ${buffer.byteLength} bytes\n\nUse temp file for full content access.`;
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  // Convert HTML to markdown for better readability
  if (cleanType === 'text/html') {
    try {
      return turndownService.turndown(text);
    } catch {
      return text; // Fallback to raw HTML
    }
  }

  // Pretty-print JSON
  if (cleanType === 'application/json') {
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text; // Fallback to raw text if parsing fails
    }
  }

  return text;
}

async function main() {
  console.log('Fetching BBC homepage...\n');
  
  try {
    const response = await fetch('https://www.bbc.com', {
      headers: {
        'User-Agent': 'Lace/1.0 (AI Assistant)'
      }
    });

    if (!response.ok) {
      console.error(`HTTP ${response.status} ${response.statusText}`);
      return;
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    
    console.log(`Content-Type: ${contentType}`);
    console.log(`Size: ${buffer.byteLength} bytes (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
    console.log('\n--- PROCESSED CONTENT (what the model sees) ---\n');
    
    const processed = processContent(buffer, contentType);
    
    // Show first 5000 characters to get a sense of the output
    if (processed.length > 5000) {
      console.log(processed.substring(0, 5000));
      console.log(`\n... [truncated - total length: ${processed.length} characters] ...`);
    } else {
      console.log(processed);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
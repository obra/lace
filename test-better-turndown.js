#!/usr/bin/env node

// Test improved turndown configuration against the local BBC HTML file
import TurndownService from 'turndown';
import { readFile } from 'fs/promises';

// Configure turndown to strip noise and focus on content (like lynx)
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_'
});

// Remove elements that don't contribute to readable content
turndownService.remove([
  'script', 
  'style', 
  'noscript', 
  'meta', 
  'link', 
  'header', 
  'svg',
  'nav',
  'footer'
]);

async function main() {
  try {
    console.log('Reading index.html...\n');
    
    const html = await readFile('index.html', 'utf-8');
    console.log(`Original HTML size: ${html.length} characters`);
    
    console.log('\n--- CONVERTING TO CLEAN MARKDOWN ---\n');
    
    const markdown = turndownService.turndown(html);
    
    // Clean up extra whitespace
    const cleanMarkdown = markdown
      .replace(/\n\s*\n\s*\n/g, '\n\n')  // Remove excessive line breaks
      .trim();
    
    console.log(`Clean markdown size: ${cleanMarkdown.length} characters`);
    console.log('\n--- FIRST 3000 CHARACTERS ---\n');
    
    console.log(cleanMarkdown);
    
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();

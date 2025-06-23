#!/usr/bin/env node

// Test turndown against the local BBC HTML file
import TurndownService from 'turndown';
import { readFile } from 'fs/promises';

const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  emDelimiter: '_'
});

async function main() {
  try {
    console.log('Reading index.html...\n');
    
    const html = await readFile('index.html', 'utf-8');
    console.log(`HTML size: ${html.length} characters`);
    
    console.log('\n--- CONVERTING TO MARKDOWN ---\n');
    
    const markdown = turndownService.turndown(html);
    
    console.log(`Markdown size: ${markdown.length} characters`);
    console.log('\n--- FIRST 3000 CHARACTERS ---\n');
    
    console.log(markdown.substring(0, 3000));
    
    if (markdown.length > 3000) {
      console.log(`\n... [truncated - total length: ${markdown.length} characters] ...`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
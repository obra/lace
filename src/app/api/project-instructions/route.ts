// ABOUTME: API endpoint for loading and saving project instructions (CLAUDE.md)
// ABOUTME: Handles reading/writing to the project's CLAUDE.md file

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

const CLAUDE_MD_PATH = path.join(process.cwd(), 'CLAUDE.md');

export async function GET() {
  try {
    let content = '';
    if (fs.existsSync(CLAUDE_MD_PATH)) {
      content = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8');
    }
    
    return NextResponse.json({ 
      content,
      path: CLAUDE_MD_PATH 
    });
  } catch (error) {
    console.error('Error loading project instructions:', error);
    return NextResponse.json(
      { error: 'Failed to load project instructions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { content } = await request.json();
    
    if (typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content must be a string' },
        { status: 400 }
      );
    }
    
    fs.writeFileSync(CLAUDE_MD_PATH, content, 'utf-8');
    
    return NextResponse.json({ 
      success: true,
      path: CLAUDE_MD_PATH 
    });
  } catch (error) {
    console.error('Error saving project instructions:', error);
    return NextResponse.json(
      { error: 'Failed to save project instructions' },
      { status: 500 }
    );
  }
}
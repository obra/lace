// ABOUTME: API endpoint for loading and saving user instructions
// ABOUTME: Handles reading/writing to ~/.lace/instructions.md file

import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import { getUserInstructionsFilePath } from '~/config/prompts';
import { ensureLaceDir } from '~/config/lace-dir';

export async function GET() {
  try {
    const instructionsPath = getUserInstructionsFilePath();
    
    let content = '';
    if (fs.existsSync(instructionsPath)) {
      content = fs.readFileSync(instructionsPath, 'utf-8');
    }
    
    return NextResponse.json({ 
      content,
      path: instructionsPath 
    });
  } catch (error) {
    console.error('Error loading instructions:', error);
    return NextResponse.json(
      { error: 'Failed to load instructions' },
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
    
    // Ensure the lace directory exists
    ensureLaceDir();
    
    const instructionsPath = getUserInstructionsFilePath();
    fs.writeFileSync(instructionsPath, content, 'utf-8');
    
    return NextResponse.json({ 
      success: true,
      path: instructionsPath 
    });
  } catch (error) {
    console.error('Error saving instructions:', error);
    return NextResponse.json(
      { error: 'Failed to save instructions' },
      { status: 500 }
    );
  }
}
// ABOUTME: Password change API route for authenticated users
// ABOUTME: Verifies current password, hashes new password, and updates auth config

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/server/api-auth';
import { hashPassword, loadAuthConfig, saveAuthConfig, verifyPassword } from '@/lib/server/auth-config';

interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Check authentication
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    // Parse request body
    let body: ChangePasswordRequest;
    try {
      body = await request.json() as ChangePasswordRequest;
    } catch {
      return NextResponse.json(
        { error: 'Invalid request format' },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!body.currentPassword || !body.newPassword || 
        !body.currentPassword.trim() || !body.newPassword.trim()) {
      return NextResponse.json(
        { error: 'Current password and new password are required' },
        { status: 400 }
      );
    }

    // Validate new password length
    if (body.newPassword.length < 8) {
      return NextResponse.json(
        { error: 'New password must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Load existing config to get current password hash and salt
    const existingConfig = await loadAuthConfig();
    if (!existingConfig || !existingConfig.passwordHash || !existingConfig.salt) {
      return NextResponse.json(
        { error: 'Authentication not configured' },
        { status: 500 }
      );
    }

    // Verify current password
    const isCurrentPasswordValid = await verifyPassword(
      body.currentPassword, 
      existingConfig.passwordHash, 
      existingConfig.salt
    );
    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      );
    }

    // Hash new password
    const { hash, salt } = await hashPassword(body.newPassword);

    // Create updated config with new password
    const updatedConfig = {
      ...existingConfig,
      passwordHash: hash,
      salt: salt,
    };

    // Save updated config
    await saveAuthConfig(updatedConfig);

    return NextResponse.json({
      success: true,
      message: 'Password changed successfully',
    });

  } catch (error) {
    console.error('Password change API error:', error);
    return NextResponse.json(
      { error: 'Password change failed' },
      { status: 500 }
    );
  }
}
// ABOUTME: System variable provider for OS, date/time, and runtime information
// ABOUTME: Provides deterministic system context variables for prompt templates

import { PromptVariableProvider } from '../types.js';
import * as os from 'os';

export class SystemVariableProvider implements PromptVariableProvider {
  private _sessionStartTime: string;

  constructor() {
    // Capture session start time once to keep it consistent
    this._sessionStartTime = new Date().toISOString();
  }

  getVariables(): Record<string, unknown> {
    const now = new Date();
    
    return {
      system: {
        os: this._getOSName(),
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version.substring(1), // Remove 'v' prefix
        hostname: os.hostname(),
        username: os.userInfo().username,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        uptime: os.uptime()
      },
      session: {
        startTime: this._sessionStartTime,
        currentTime: now.toISOString(),
        currentDate: now.toISOString().split('T')[0], // YYYY-MM-DD format
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale
      }
    };
  }

  private _getOSName(): string {
    const platform = os.platform();
    
    switch (platform) {
      case 'darwin':
        return 'macOS';
      case 'win32':
        return 'Windows';
      case 'linux':
        return 'Linux';
      case 'freebsd':
        return 'FreeBSD';
      case 'openbsd':
        return 'OpenBSD';
      case 'sunos':
        return 'Solaris';
      case 'aix':
        return 'AIX';
      default:
        return platform;
    }
  }
}
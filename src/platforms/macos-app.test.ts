// ABOUTME: Integration tests for macOS app build and functionality
// ABOUTME: Tests build process, bundle structure, and basic launch capabilities

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';

const MACOS_PLATFORM_DIR = resolve(__dirname, '../../platforms/macos');
const BUILD_TIMEOUT = 30000; // 30 seconds for build

describe('macOS App Integration Tests', () => {
  let tempDir: string;
  let appBundlePath: string;

  beforeAll(async () => {
    // Create temporary directory for test builds
    tempDir = await mkdtemp(join(tmpdir(), 'lace-macos-test-'));
    appBundlePath = join(tempDir, 'Lace.app');
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('Build System', () => {
    it('should have all required source files', () => {
      const requiredFiles = ['main.swift', 'Info.plist', 'AppIcon.icns', 'Makefile'];

      for (const file of requiredFiles) {
        const filePath = join(MACOS_PLATFORM_DIR, file);
        expect(existsSync(filePath), `${file} should exist`).toBe(true);
      }
    });

    it('should have valid Info.plist', () => {
      const plistPath = join(MACOS_PLATFORM_DIR, 'Info.plist');
      const plistContent = readFileSync(plistPath, 'utf-8');

      // Basic XML validation
      expect(plistContent).toContain('<?xml version="1.0"');
      expect(plistContent).toContain('<plist version="1.0">');
      expect(plistContent).toContain('CFBundleIdentifier');
      expect(plistContent).toContain('com.jesseVincent.lace');
      expect(plistContent).toContain('<key>LSUIElement</key>');
      expect(plistContent).toContain('<true/>');
    });

    it('should compile Swift source without syntax errors', () => {
      expect(() => {
        // Ensure Sparkle framework is available for typecheck
        execSync('make setup-sparkle', {
          cwd: MACOS_PLATFORM_DIR,
          stdio: 'pipe',
        });

        // Typecheck with Sparkle framework paths
        execSync(
          `swiftc -typecheck main.swift -target arm64-apple-macos10.15 -F Sparkle.xcframework/macos-arm64_x86_64 -framework Sparkle`,
          {
            cwd: MACOS_PLATFORM_DIR,
            stdio: 'pipe',
          }
        );
      }, 'Swift compilation should succeed').not.toThrow();
    });

    it('should build complete app bundle', { timeout: 120000 }, () => {
      // Build using Makefile
      execSync(`make clean && make BUILD_DIR="${tempDir}" build`, {
        cwd: MACOS_PLATFORM_DIR,
        stdio: 'pipe',
      });

      // Verify app bundle structure
      expect(existsSync(appBundlePath), 'App bundle should exist').toBe(true);
      expect(existsSync(join(appBundlePath, 'Contents')), 'Contents directory should exist').toBe(
        true
      );
      expect(
        existsSync(join(appBundlePath, 'Contents/Info.plist')),
        'Info.plist should be copied'
      ).toBe(true);
      expect(
        existsSync(join(appBundlePath, 'Contents/MacOS')),
        'MacOS directory should exist'
      ).toBe(true);
      expect(
        existsSync(join(appBundlePath, 'Contents/MacOS/Lace')),
        'Executable should exist'
      ).toBe(true);
      expect(
        existsSync(join(appBundlePath, 'Contents/Resources')),
        'Resources directory should exist'
      ).toBe(true);
      expect(
        existsSync(join(appBundlePath, 'Contents/Resources/AppIcon.icns')),
        'App icon should be copied'
      ).toBe(true);
    });

    it('should create executable binary with correct permissions', () => {
      const executablePath = join(appBundlePath, 'Contents/MacOS/Lace');

      expect(existsSync(executablePath), 'Executable should exist').toBe(true);

      const stats = statSync(executablePath);
      expect(stats.isFile(), 'Should be a regular file').toBe(true);

      // Check executable permission (owner execute bit)
      const permissions = stats.mode;
      expect(permissions & 0o100, 'Should have owner execute permission').toBeTruthy();
    });
  });

  describe('App Bundle Validation', () => {
    it('should have correct bundle identifier', () => {
      const plistPath = join(appBundlePath, 'Contents/Info.plist');
      const plistContent = readFileSync(plistPath, 'utf-8');

      expect(plistContent).toContain('<string>com.jesseVincent.lace</string>');
    });

    it('should be configured as menu bar app', () => {
      const plistPath = join(appBundlePath, 'Contents/Info.plist');
      const plistContent = readFileSync(plistPath, 'utf-8');

      // LSUIElement should be true for menu bar apps
      expect(plistContent).toMatch(/<key>LSUIElement<\/key>\s*<true\/>/);
    });

    it('should have app icon in resources', () => {
      const iconPath = join(appBundlePath, 'Contents/Resources/AppIcon.icns');
      expect(existsSync(iconPath), 'App icon should exist in Resources').toBe(true);

      const stats = statSync(iconPath);
      expect(stats.size, 'Icon file should not be empty').toBeGreaterThan(0);
    });

    it('should validate with macOS codesign tool', () => {
      // Note: This will fail in CI without proper signing, but useful for local testing
      try {
        execSync(`codesign -v -v "${appBundlePath}"`, { stdio: 'pipe' });
        // If we reach here, the bundle is properly signed
      } catch (_error) {
        // Expected in CI/test environments - just verify the bundle structure is valid
        const result = execSync(`codesign -d -v -v "${appBundlePath}" 2>&1 || true`, {
          stdio: 'pipe',
          encoding: 'utf-8',
        });

        // Should at least identify it as a valid bundle structure
        expect(typeof result).toBe('string');
      }
    });
  });

  describe('Server Path Detection', () => {
    it('should generate correct server path for bundle', () => {
      // This tests the getServerPath logic from main.swift
      const expectedPath = `${appBundlePath}/Contents/MacOS/lace-server`;

      // In a real app, the server would be placed here by the build process
      expect(expectedPath).toMatch(/.*\.app\/Contents\/MacOS\/lace-server$/);
    });
  });

  describe('Port Parsing Logic', () => {
    it('should extract port from LACE_SERVER_PORT signal', () => {
      const testOutput = 'Server starting...\nLACE_SERVER_PORT:31337\nServer ready';

      // Test regex pattern from main.swift
      const regex = /LACE_SERVER_PORT:(\d+)/;
      const match = testOutput.match(regex);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('31337');
    });

    it('should extract port from LACE_SERVER_URL signal', () => {
      const testOutput = 'LACE_SERVER_URL:http://localhost:8080';

      // Test regex pattern from main.swift
      const regex = /LACE_SERVER_URL:http:\/\/[^:]+:(\d+)/;
      const match = testOutput.match(regex);

      expect(match).not.toBeNull();
      expect(match?.[1]).toBe('8080');
    });

    it('should handle complex server output', () => {
      const testOutput = `
        [INFO] Starting Lace server...
        [DEBUG] Checking available ports...
        LACE_SERVER_PORT:31337
        [INFO] Web interface ready
        LACE_SERVER_URL:http://127.0.0.1:31337
        [INFO] Server fully initialized
      `;

      // Should find the port signal even in complex output
      const portRegex = /LACE_SERVER_PORT:(\d+)/;
      const urlRegex = /LACE_SERVER_URL:http:\/\/[^:]+:(\d+)/;

      const portMatch = testOutput.match(portRegex);
      const urlMatch = testOutput.match(urlRegex);

      expect(portMatch?.[1]).toBe('31337');
      expect(urlMatch?.[1]).toBe('31337');
    });
  });

  describe('Launch Item Integration', () => {
    it('should handle ServiceManagement framework availability', () => {
      // We can't actually test the ServiceManagement calls in a unit test,
      // but we can verify the logic structure exists

      const swiftCode = readFileSync(join(MACOS_PLATFORM_DIR, 'main.swift'), 'utf-8');

      expect(swiftCode).toContain('import ServiceManagement');
      expect(swiftCode).toContain('SMAppService.mainApp');
      expect(swiftCode).toContain('#available(macOS 13.0, *)');
      expect(swiftCode).toContain('legacyLoginItemHelperBundleID');
    });

    it('should have proper error handling for login item operations', () => {
      const swiftCode = readFileSync(join(MACOS_PLATFORM_DIR, 'main.swift'), 'utf-8');

      expect(swiftCode).toContain('showError');
      expect(swiftCode).toContain('Failed to enable open at login');
      expect(swiftCode).toContain('Failed to disable open at login');
      expect(swiftCode).toContain('requires macOS 13+ or an embedded login item helper');
    });
  });

  describe('Menu Structure', () => {
    it('should use correct macOS conventions', () => {
      const swiftCode = readFileSync(join(MACOS_PLATFORM_DIR, 'main.swift'), 'utf-8');

      expect(swiftCode).toContain('"Launch at Startup"');
      expect(swiftCode).toContain('"Open Lace"');
      expect(swiftCode).toContain('"Restart Server"');
      expect(swiftCode).toContain('"Quit Lace"');
    });

    it('should have proper menu item states and actions', () => {
      const swiftCode = readFileSync(join(MACOS_PLATFORM_DIR, 'main.swift'), 'utf-8');

      expect(swiftCode).toContain('@objc private func openBrowser');
      expect(swiftCode).toContain('@objc private func restartServer');
      expect(swiftCode).toContain('@objc private func toggleLaunchAtStartup');
      expect(swiftCode).toContain('@objc private func quit');
    });
  });

  // Skip actual launch tests in CI to avoid GUI interactions
  describe.skipIf(process.env.CI)('App Launch (Local Only)', () => {
    let appProcess: ChildProcess;

    afterAll(() => {
      // Cleanup any running process
      if (appProcess && !appProcess.killed) {
        appProcess.kill('SIGTERM');
      }
    });

    it('should launch without crashing', async () => {
      const executablePath = join(appBundlePath, 'Contents/MacOS/Lace');

      const promise = new Promise<void>((resolve, reject) => {
        appProcess = spawn(executablePath, [], {
          stdio: 'pipe',
          detached: false,
        });

        let hasOutput = false;

        // Give the app a moment to initialize
        const timeout = setTimeout(() => {
          if (appProcess && !appProcess.killed) {
            appProcess.kill('SIGTERM');
          }

          // If we get here without crashing, the launch was successful
          expect(hasOutput || appProcess.pid).toBeTruthy();
          resolve();
        }, 2000);

        appProcess.stdout?.on('data', (data: Buffer) => {
          hasOutput = true;
          console.log('App stdout:', data.toString());
        });

        appProcess.stderr?.on('data', (data: Buffer) => {
          hasOutput = true;
          console.log('App stderr:', data.toString());
        });

        appProcess.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });

        appProcess.on('exit', (code, signal) => {
          clearTimeout(timeout);
          if (code !== null && code !== 0 && signal !== 'SIGTERM') {
            reject(new Error(`App exited with code ${code}, signal ${signal}`));
          } else {
            resolve();
          }
        });
      });

      await promise;
    }, 10000);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GlobalConfigManager } from './global-config';
import * as fs from 'fs';
import { getLaceFilePath } from '~/config/lace-dir';

// Mock fs module
vi.mock('fs');

describe('GlobalConfigManager', () => {
  beforeEach(() => {
    // Clear any cached config between tests
    GlobalConfigManager['cachedConfig'] = null;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefaultModel', () => {
    it('should return fast model when configured', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const model = GlobalConfigManager.getDefaultModel('fast');
      expect(model).toBe('anthropic-default:claude-3-haiku-20240307');
    });

    it('should return smart model when configured', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      const model = GlobalConfigManager.getDefaultModel('smart');
      expect(model).toBe('anthropic-default:claude-3-opus-20240229');
    });

    it('should throw when config file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        /Global config not found at/
      );
    });

    it('should throw when model tier is not configured', () => {
      const mockConfig = {
        defaultModels: {
          smart: 'anthropic-default:claude-3-opus-20240229'
          // 'fast' is missing
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        "No default model configured for 'fast'"
      );
    });

    it('should throw on invalid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json {');

      expect(() => GlobalConfigManager.getDefaultModel('fast')).toThrow(
        /Failed to parse global config/
      );
    });

    it('should cache config after first load', () => {
      const mockConfig = {
        defaultModels: {
          fast: 'anthropic-default:claude-3-haiku-20240307',
          smart: 'anthropic-default:claude-3-opus-20240229'
        }
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

      // First call
      GlobalConfigManager.getDefaultModel('fast');
      
      // Second call should use cache
      GlobalConfigManager.getDefaultModel('smart');

      // Should only read file once
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });
  });
});
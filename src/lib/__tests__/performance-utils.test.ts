// ABOUTME: Tests for performance utilities used in syntax highlighting
// ABOUTME: Tests caching, debouncing, and performance monitoring

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCachedHighlightResult,
  setCachedHighlightResult,
  clearHighlightCache,
  debounce,
  throttle,
  isCodeTooLarge,
  splitLargeCode,
  estimateMemoryUsage,
  performanceMonitor,
} from '../performance-utils';

describe('Performance Utils', () => {
  beforeEach(() => {
    clearHighlightCache();
    performanceMonitor.reset();
  });

  describe('caching', () => {
    it('should cache and retrieve highlight results', () => {
      const code = 'console.log("test");';
      const result = {
        highlighted: '<span class="hljs-string">console.log("test");</span>',
        language: 'javascript',
        success: true,
      };

      setCachedHighlightResult(code, result, 'javascript');
      const cached = getCachedHighlightResult(code, 'javascript');

      expect(cached).toEqual(result);
    });

    it('should return null for non-existent cache entries', () => {
      const cached = getCachedHighlightResult('nonexistent', 'javascript');
      expect(cached).toBeNull();
    });

    it('should handle different cache keys', () => {
      const code = 'print("test")';
      const result1 = {
        highlighted: '<span class="hljs-string">print("test")</span>',
        language: 'python',
        success: true,
      };
      const result2 = {
        highlighted: '<span class="hljs-string">print("test")</span>',
        language: 'javascript',
        success: true,
      };

      setCachedHighlightResult(code, result1, 'python');
      setCachedHighlightResult(code, result2, 'javascript');

      expect(getCachedHighlightResult(code, 'python')).toEqual(result1);
      expect(getCachedHighlightResult(code, 'javascript')).toEqual(result2);
    });

    it('should clear cache', () => {
      const code = 'test';
      const result = { highlighted: 'test', language: 'plaintext', success: true };

      setCachedHighlightResult(code, result);
      clearHighlightCache();

      expect(getCachedHighlightResult(code)).toBeNull();
    });

    it('should handle filename in cache key', () => {
      const code = 'print("test")';
      const result = {
        highlighted: '<span class="hljs-string">print("test")</span>',
        language: 'python',
        success: true,
      };

      setCachedHighlightResult(code, result, 'python', 'script.py');
      
      expect(getCachedHighlightResult(code, 'python', 'script.py')).toEqual(result);
      expect(getCachedHighlightResult(code, 'python', 'other.py')).toBeNull();
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      const fn = vi.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn('arg1');
      debouncedFn('arg2');
      debouncedFn('arg3');

      expect(fn).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('arg3');
    });

    it('should allow canceling debounced calls', async () => {
      const fn = vi.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn('arg1');
      debouncedFn.cancel();

      await new Promise(resolve => setTimeout(resolve, 150));
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      const fn = vi.fn((x) => x * 2);
      const throttledFn = throttle(fn, 100);

      const result1 = throttledFn(5);
      const result2 = throttledFn(10);
      const result3 = throttledFn(15);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(5);
      expect(result1).toBe(10);
      expect(result2).toBe(10); // Should return cached result
      expect(result3).toBe(10); // Should return cached result
    });

    it('should allow function calls after throttle period', async () => {
      const fn = vi.fn((x) => x * 2);
      const throttledFn = throttle(fn, 50);

      throttledFn(5);
      expect(fn).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 60));
      
      throttledFn(10);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith(10);
    });
  });

  describe('code size utilities', () => {
    it('should detect large code', () => {
      const smallCode = 'console.log("test");';
      const largeCode = 'x'.repeat(200000);

      expect(isCodeTooLarge(smallCode)).toBe(false);
      expect(isCodeTooLarge(largeCode)).toBe(true);
    });

    it('should respect custom size limit', () => {
      const code = 'x'.repeat(1000);

      expect(isCodeTooLarge(code, 500)).toBe(true);
      expect(isCodeTooLarge(code, 1500)).toBe(false);
    });

    it('should split large code into chunks', () => {
      const code = 'line1\nline2\nline3\nline4\nline5';
      const chunks = splitLargeCode(code, 15);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join('\n')).toBe(code);
    });

    it('should not split small code', () => {
      const code = 'small code';
      const chunks = splitLargeCode(code, 1000);

      expect(chunks).toEqual([code]);
    });

    it('should estimate memory usage', () => {
      const code = 'console.log("test");';
      const estimated = estimateMemoryUsage(code);

      expect(estimated).toBe(code.length * 2.5);
    });
  });

  describe('performance monitoring', () => {
    it('should record timing metrics', () => {
      const endTiming = performanceMonitor.startTiming('test-operation');
      
      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Wait for a bit
      }
      
      endTiming();

      const average = performanceMonitor.getAverageTime('test-operation');
      expect(average).toBeGreaterThan(0);
    });

    it('should track multiple measurements', () => {
      for (let i = 0; i < 5; i++) {
        const endTiming = performanceMonitor.startTiming('test-operation');
        endTiming();
      }

      const metrics = performanceMonitor.getAllMetrics();
      expect(metrics['test-operation']).toBeDefined();
      expect(metrics['test-operation'].count).toBe(5);
    });

    it('should calculate average times', () => {
      // Record some measurements
      performanceMonitor.startTiming('fast-op')(); // 0ms
      
      const endTiming = performanceMonitor.startTiming('slow-op');
      const start = Date.now();
      while (Date.now() - start < 5) {
        // Wait for a bit
      }
      endTiming();

      const fastAvg = performanceMonitor.getAverageTime('fast-op');
      const slowAvg = performanceMonitor.getAverageTime('slow-op');

      expect(fastAvg).toBeLessThan(slowAvg);
    });

    it('should reset metrics', () => {
      performanceMonitor.startTiming('test-operation')();
      
      expect(performanceMonitor.getAverageTime('test-operation')).toBeGreaterThan(0);
      
      performanceMonitor.reset();
      
      expect(performanceMonitor.getAverageTime('test-operation')).toBe(0);
    });

    it('should return zero for non-existent metrics', () => {
      const average = performanceMonitor.getAverageTime('nonexistent');
      expect(average).toBe(0);
    });
  });
});
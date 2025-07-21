// ABOUTME: Performance utilities for syntax highlighting system
// ABOUTME: Includes debouncing, caching, and memory management

import { type HighlightResult } from './syntax-highlighting';

// Cache for highlighted code
const _highlightCache = new Map<string, HighlightResult>();
const MAX_CACHE_SIZE = 1000;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  result: HighlightResult;
  timestamp: number;
}

// LRU cache implementation
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

// Create cache instance
const cache = new LRUCache<string, CacheEntry>(MAX_CACHE_SIZE);

/**
 * Generate cache key for code highlighting
 */
function generateCacheKey(code: string, language?: string, filename?: string): string {
  const codeHash = hashCode(code);
  return `${codeHash}-${language || 'auto'}-${filename || 'unknown'}`;
}

/**
 * Simple hash function for cache keys
 */
function hashCode(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Get cached highlight result
 */
export function getCachedHighlightResult(
  code: string,
  language?: string,
  filename?: string
): HighlightResult | null {
  const key = generateCacheKey(code, language, filename);
  const entry = cache.get(key);
  
  if (entry) {
    // Check if entry is still valid
    if (Date.now() - entry.timestamp < CACHE_TTL) {
      return entry.result;
    } else {
      // Entry expired, remove it
      cache.set(key, entry); // This will remove it from cache
    }
  }
  
  return null;
}

/**
 * Cache highlight result
 */
export function setCachedHighlightResult(
  code: string,
  result: HighlightResult,
  language?: string,
  filename?: string
): void {
  const key = generateCacheKey(code, language, filename);
  cache.set(key, {
    result,
    timestamp: Date.now(),
  });
}

/**
 * Clear highlight cache
 */
export function clearHighlightCache(): void {
  cache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  hitRate: number;
} {
  return {
    size: cache.size(),
    maxSize: MAX_CACHE_SIZE,
    hitRate: 0, // TODO: Implement hit rate tracking
  };
}

/**
 * Debounce function for reducing rapid API calls
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): T & { cancel: () => void } {
  let timeout: NodeJS.Timeout | null = null;

  const debounced = ((...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    
    timeout = setTimeout(() => {
      func(...args);
      timeout = null;
    }, wait);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  return debounced;
}

/**
 * Throttle function for limiting execution frequency
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): T & { cancel: () => void } {
  let inThrottle = false;
  let lastResult: ReturnType<T>;

  const throttled = ((...args: Parameters<T>) => {
    if (!inThrottle) {
      lastResult = func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
    return lastResult;
  }) as T & { cancel: () => void };

  throttled.cancel = () => {
    inThrottle = false;
  };

  return throttled;
}

/**
 * Check if code is too large for highlighting
 */
export function isCodeTooLarge(code: string, maxSize = 100000): boolean {
  return code.length > maxSize;
}

/**
 * Split large code into chunks for processing
 */
export function splitLargeCode(code: string, chunkSize = 10000): string[] {
  const chunks: string[] = [];
  const lines = code.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if (currentChunk.length + line.length + 1 > chunkSize) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
    }
    currentChunk += (currentChunk ? '\n' : '') + line;
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Estimate memory usage of syntax highlighting
 */
export function estimateMemoryUsage(code: string): number {
  // Rough estimate: highlighted code is ~2-3x the size of original
  return code.length * 2.5;
}

/**
 * Check if browser supports Web Workers
 */
export function supportsWebWorkers(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Cleanup function for performance optimization
 */
export function cleanup(): void {
  clearHighlightCache();
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics = new Map<string, number[]>();

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  startTiming(key: string): () => void {
    const start = performance.now();
    
    return () => {
      const end = performance.now();
      const duration = end - start;
      
      if (!this.metrics.has(key)) {
        this.metrics.set(key, []);
      }
      
      const times = this.metrics.get(key);
      if (times) {
        times.push(duration);
        
        // Keep only last 100 measurements
        if (times.length > 100) {
          times.shift();
        }
      }
    };
  }

  getAverageTime(key: string): number {
    const times = this.metrics.get(key);
    if (!times || times.length === 0) return 0;
    
    const sum = times.reduce((acc, time) => acc + time, 0);
    return sum / times.length;
  }

  getAllMetrics(): Record<string, { average: number; count: number }> {
    const result: Record<string, { average: number; count: number }> = {};
    
    for (const [key, times] of this.metrics) {
      result[key] = {
        average: this.getAverageTime(key),
        count: times.length,
      };
    }
    
    return result;
  }

  reset(): void {
    this.metrics.clear();
  }
}

// Export singleton instance
export const performanceMonitor = PerformanceMonitor.getInstance();
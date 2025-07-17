// ABOUTME: Comprehensive syntax highlighting service with lazy loading and language detection
// ABOUTME: Provides unified interface for both terminal and web syntax highlighting

import hljs from 'highlight.js/lib/core';
import { 
  getCachedHighlightResult, 
  setCachedHighlightResult, 
  isCodeTooLarge, 
  splitLargeCode,
  performanceMonitor
} from './performance-utils';

// Language registry for lazy loading
const LANGUAGE_REGISTRY = new Map<string, () => Promise<any>>();

// Common programming languages with their lazy import functions
const LANGUAGE_IMPORTS = {
  // Web languages
  javascript: () => import('highlight.js/lib/languages/javascript'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  jsx: () => import('highlight.js/lib/languages/javascript'), // Use JS for JSX
  tsx: () => import('highlight.js/lib/languages/typescript'), // Use TS for TSX
  html: () => import('highlight.js/lib/languages/xml'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  json: () => import('highlight.js/lib/languages/json'),
  xml: () => import('highlight.js/lib/languages/xml'),
  
  // System languages
  bash: () => import('highlight.js/lib/languages/bash'),
  shell: () => import('highlight.js/lib/languages/bash'),
  sh: () => import('highlight.js/lib/languages/bash'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  
  // Programming languages
  python: () => import('highlight.js/lib/languages/python'),
  java: () => import('highlight.js/lib/languages/java'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  'c++': () => import('highlight.js/lib/languages/cpp'),
  c: () => import('highlight.js/lib/languages/c'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  'c#': () => import('highlight.js/lib/languages/csharp'),
  go: () => import('highlight.js/lib/languages/go'),
  rust: () => import('highlight.js/lib/languages/rust'),
  php: () => import('highlight.js/lib/languages/php'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  swift: () => import('highlight.js/lib/languages/swift'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  
  // Data/Config languages
  yaml: () => import('highlight.js/lib/languages/yaml'),
  yml: () => import('highlight.js/lib/languages/yaml'),
  toml: () => import('highlight.js/lib/languages/ini'), // Use INI for TOML
  ini: () => import('highlight.js/lib/languages/ini'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  
  // Database languages
  sql: () => import('highlight.js/lib/languages/sql'),
  
  // Markup languages
  markdown: () => import('highlight.js/lib/languages/markdown'),
  md: () => import('highlight.js/lib/languages/markdown'),
  
  // Other languages
  plaintext: () => Promise.resolve(null), // No highlighting for plaintext
  text: () => Promise.resolve(null), // No highlighting for text
} as const;

// Language aliases for common file extensions
const LANGUAGE_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  cs: 'csharp',
  cc: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  h: 'c',
  rs: 'rust',
  kt: 'kotlin',
  pl: 'perl',
  yml: 'yaml',
  zsh: 'bash',
  fish: 'shell',
  ps1: 'powershell',
  htm: 'html',
  jsx: 'javascript',
  tsx: 'typescript',
  vue: 'html',
  svelte: 'html',
} as const;

// Language detection patterns
const LANGUAGE_PATTERNS = {
  javascript: [
    /^#!.*node/,
    /import\s+.*from/,
    /require\s*\(/,
    /export\s+(default\s+)?/,
    /const\s+\w+\s*=/,
    /function\s+\w+\s*\(/
  ],
  typescript: [
    /interface\s+\w+/,
    /type\s+\w+\s*=/,
    /import\s+.*from.*\.ts/,
    /export\s+type/,
    /as\s+\w+/
  ],
  python: [
    /^#!.*python/,
    /import\s+\w+/,
    /from\s+\w+\s+import/,
    /def\s+\w+\s*\(/,
    /class\s+\w+\s*\(/
  ],
  bash: [
    /^#!.*bash/,
    /^#!.*sh/,
    /echo\s+/,
    /if\s*\[/,
    /for\s+\w+\s+in/
  ],
  json: [
    /^\s*\{/,
    /^\s*\[/,
    /"[^"]*"\s*:\s*/,
    /^\s*"[^"]*"\s*$/
  ],
  css: [
    /\.[a-zA-Z][\w-]*\s*\{/,
    /#[a-zA-Z][\w-]*\s*\{/,
    /[a-zA-Z-]+\s*:\s*[^;]+;/
  ],
  html: [
    /<[a-zA-Z][\w-]*/,
    /<\/[a-zA-Z][\w-]*>/,
    /<!DOCTYPE/i
  ],
  xml: [
    /<\?xml/,
    /<[a-zA-Z][\w-]*[^>]*>/,
    /<\/[a-zA-Z][\w-]*>/
  ],
  yaml: [
    /^[a-zA-Z][\w-]*:\s*/,
    /^-\s+/,
    /^\s*-\s+[a-zA-Z]/
  ],
  sql: [
    /SELECT\s+/i,
    /FROM\s+/i,
    /WHERE\s+/i,
    /INSERT\s+INTO/i,
    /UPDATE\s+/i,
    /DELETE\s+FROM/i
  ],
  dockerfile: [
    /^FROM\s+/,
    /^RUN\s+/,
    /^COPY\s+/,
    /^ADD\s+/,
    /^ENV\s+/,
    /^WORKDIR\s+/
  ]
} as const;

// Cached language modules
const languageCache = new Map<string, any>();

// Initialize the syntax highlighting service
export class SyntaxHighlightingService {
  private static instance: SyntaxHighlightingService;
  private initialized = false;

  private constructor() {}

  static getInstance(): SyntaxHighlightingService {
    if (!SyntaxHighlightingService.instance) {
      SyntaxHighlightingService.instance = new SyntaxHighlightingService();
    }
    return SyntaxHighlightingService.instance;
  }

  /**
   * Initialize the service with common languages
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Pre-load essential languages
    const essentialLanguages = ['javascript', 'typescript', 'json', 'bash', 'python', 'html', 'css'];
    
    await Promise.all(
      essentialLanguages.map(async (lang) => {
        try {
          await this.loadLanguage(lang);
        } catch (error) {
          console.warn(`Failed to load essential language ${lang}:`, error);
        }
      })
    );

    this.initialized = true;
  }

  /**
   * Load a language module dynamically
   */
  private async loadLanguage(language: string): Promise<void> {
    const normalizedLang = this.normalizeLanguage(language);
    
    if (languageCache.has(normalizedLang)) {
      return;
    }

    const importFn = LANGUAGE_IMPORTS[normalizedLang as keyof typeof LANGUAGE_IMPORTS];
    if (!importFn) {
      throw new Error(`Language ${normalizedLang} is not supported`);
    }

    try {
      const module = await importFn();
      if (module && module.default) {
        hljs.registerLanguage(normalizedLang, module.default);
        languageCache.set(normalizedLang, module.default);
      }
    } catch (error) {
      console.warn(`Failed to load language ${normalizedLang}:`, error);
      throw error;
    }
  }

  /**
   * Normalize language name and handle aliases
   */
  private normalizeLanguage(language: string): string {
    const normalized = language.toLowerCase().trim();
    return LANGUAGE_ALIASES[normalized as keyof typeof LANGUAGE_ALIASES] || normalized;
  }

  /**
   * Detect language from code content
   */
  detectLanguage(code: string, filename?: string): string {
    // Try to detect from filename extension
    if (filename) {
      const extension = filename.split('.').pop()?.toLowerCase();
      if (extension && LANGUAGE_IMPORTS[extension as keyof typeof LANGUAGE_IMPORTS]) {
        return extension;
      }
      if (extension && LANGUAGE_ALIASES[extension as keyof typeof LANGUAGE_ALIASES]) {
        return LANGUAGE_ALIASES[extension as keyof typeof LANGUAGE_ALIASES];
      }
    }

    // Try to detect from code patterns
    const codeLines = code.split('\n').slice(0, 10); // Check first 10 lines
    const codeForPatterns = codeLines.join('\n');

    for (const [language, patterns] of Object.entries(LANGUAGE_PATTERNS)) {
      if (patterns.some(pattern => pattern.test(codeForPatterns))) {
        return language;
      }
    }

    return 'plaintext';
  }

  /**
   * Get list of supported languages
   */
  getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_IMPORTS);
  }

  /**
   * Check if a language is supported
   */
  isLanguageSupported(language: string): boolean {
    const normalized = this.normalizeLanguage(language);
    return normalized in LANGUAGE_IMPORTS;
  }

  /**
   * Highlight code with the specified language
   */
  async highlightCode(code: string, language?: string, filename?: string): Promise<{
    highlighted: string;
    language: string;
    success: boolean;
  }> {
    const endTiming = performanceMonitor.startTiming('highlightCode');
    
    try {
      if (!code.trim()) {
        return { highlighted: code, language: 'plaintext', success: true };
      }

      // Check cache first
      const cached = getCachedHighlightResult(code, language, filename);
      if (cached) {
        return cached;
      }

      // Detect language if not provided
      const detectedLanguage = language || this.detectLanguage(code, filename);
      const normalizedLang = this.normalizeLanguage(detectedLanguage);

      // Handle plaintext/text without highlighting
      if (normalizedLang === 'plaintext' || normalizedLang === 'text') {
        const result = { highlighted: code, language: normalizedLang, success: true };
        setCachedHighlightResult(code, result, language, filename);
        return result;
      }

      // Check if code is too large for highlighting
      if (isCodeTooLarge(code)) {
        console.warn('Code is too large for syntax highlighting, falling back to plaintext');
        const result = { highlighted: code, language: 'plaintext', success: false };
        setCachedHighlightResult(code, result, language, filename);
        return result;
      }

      try {
        // Load language if not already loaded
        if (!languageCache.has(normalizedLang)) {
          await this.loadLanguage(normalizedLang);
        }

        // Highlight the code
        const result = hljs.highlight(code, { language: normalizedLang, ignoreIllegals: true });
        
        const finalResult = {
          highlighted: result.value,
          language: normalizedLang,
          success: true,
        };

        // Cache the result
        setCachedHighlightResult(code, finalResult, language, filename);
        
        return finalResult;
      } catch (error) {
        console.warn(`Failed to highlight code with language ${normalizedLang}:`, error);
        
        // Fallback to auto-detection
        try {
          const result = hljs.highlightAuto(code, this.getSupportedLanguages());
          const finalResult = {
            highlighted: result.value,
            language: result.language || 'plaintext',
            success: true,
          };
          
          setCachedHighlightResult(code, finalResult, language, filename);
          return finalResult;
        } catch (autoError) {
          console.warn('Auto-detection also failed:', autoError);
          const finalResult = {
            highlighted: code,
            language: 'plaintext',
            success: false,
          };
          
          setCachedHighlightResult(code, finalResult, language, filename);
          return finalResult;
        }
      }
    } finally {
      endTiming();
    }
  }

  /**
   * Highlight large code in chunks
   */
  async highlightLargeCode(code: string, language?: string, filename?: string): Promise<{
    highlighted: string;
    language: string;
    success: boolean;
  }> {
    const endTiming = performanceMonitor.startTiming('highlightLargeCode');
    
    try {
      if (!isCodeTooLarge(code)) {
        return this.highlightCode(code, language, filename);
      }

      const chunks = splitLargeCode(code);
      const highlightedChunks: string[] = [];
      let finalLanguage = language || 'plaintext';
      let success = true;

      for (const chunk of chunks) {
        const result = await this.highlightCode(chunk, language, filename);
        highlightedChunks.push(result.highlighted);
        
        if (result.language !== 'plaintext') {
          finalLanguage = result.language;
        }
        
        if (!result.success) {
          success = false;
        }
      }

      return {
        highlighted: highlightedChunks.join('\n'),
        language: finalLanguage,
        success,
      };
    } finally {
      endTiming();
    }
  }

  /**
   * Get language information
   */
  getLanguageInfo(language: string): {
    name: string;
    aliases: string[];
    extensions: string[];
  } {
    const normalized = this.normalizeLanguage(language);
    
    // Create reverse mapping for aliases
    const aliases = Object.entries(LANGUAGE_ALIASES)
      .filter(([, target]) => target === normalized)
      .map(([alias]) => alias);

    return {
      name: normalized,
      aliases,
      extensions: aliases.filter(alias => alias.includes('.')),
    };
  }
}

// Export singleton instance
export const syntaxHighlighting = SyntaxHighlightingService.getInstance();

// Export types for use in components
export interface HighlightResult {
  highlighted: string;
  language: string;
  success: boolean;
}

export interface LanguageInfo {
  name: string;
  aliases: string[];
  extensions: string[];
}
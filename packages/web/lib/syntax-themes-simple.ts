// ABOUTME: Simplified syntax highlighting theme management with built-in styles
// ABOUTME: Provides theme switching without external CSS dependencies

export interface SyntaxTheme {
  name: string;
  displayName: string;
  mode: 'light' | 'dark';
  styles: string;
  description: string;
}

// Built-in syntax highlighting themes as CSS strings
export const SYNTAX_THEMES: Record<string, SyntaxTheme> = {
  'github-light': {
    name: 'github-light',
    displayName: 'GitHub Light',
    mode: 'light',
    description: 'Clean GitHub-style light theme',
    styles: `
      .hljs {
        display: block;
        overflow-x: auto;
        padding: 0.5em;
        color: #333;
        background: #f8f8f8;
      }
      .hljs-comment,
      .hljs-quote {
        color: #998;
        font-style: italic;
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-subst {
        color: #333;
        font-weight: bold;
      }
      .hljs-number,
      .hljs-literal,
      .hljs-variable,
      .hljs-template-variable,
      .hljs-tag .hljs-attr {
        color: #008080;
      }
      .hljs-string,
      .hljs-doctag {
        color: #d14;
      }
      .hljs-title,
      .hljs-section,
      .hljs-selector-id {
        color: #900;
        font-weight: bold;
      }
      .hljs-subst {
        font-weight: normal;
      }
      .hljs-type,
      .hljs-class .hljs-title {
        color: #458;
        font-weight: bold;
      }
      .hljs-tag,
      .hljs-name,
      .hljs-attribute {
        color: #000080;
        font-weight: normal;
      }
      .hljs-regexp,
      .hljs-link {
        color: #009926;
      }
      .hljs-symbol,
      .hljs-bullet {
        color: #990073;
      }
      .hljs-built_in,
      .hljs-builtin-name {
        color: #0086b3;
      }
      .hljs-meta {
        color: #999;
        font-weight: bold;
      }
      .hljs-deletion {
        background: #fdd;
      }
      .hljs-addition {
        background: #dfd;
      }
      .hljs-emphasis {
        font-style: italic;
      }
      .hljs-strong {
        font-weight: bold;
      }
    `,
  },
  'github-dark': {
    name: 'github-dark',
    displayName: 'GitHub Dark',
    mode: 'dark',
    description: 'GitHub-style dark theme',
    styles: `
      .hljs {
        display: block;
        overflow-x: auto;
        padding: 0.5em;
        color: #e6edf3;
        background: #0d1117;
      }
      .hljs-comment,
      .hljs-quote {
        color: #8b949e;
        font-style: italic;
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-subst {
        color: #ff7b72;
        font-weight: bold;
      }
      .hljs-number,
      .hljs-literal,
      .hljs-variable,
      .hljs-template-variable,
      .hljs-tag .hljs-attr {
        color: #79c0ff;
      }
      .hljs-string,
      .hljs-doctag {
        color: #a5d6ff;
      }
      .hljs-title,
      .hljs-section,
      .hljs-selector-id {
        color: #d2a8ff;
        font-weight: bold;
      }
      .hljs-subst {
        font-weight: normal;
      }
      .hljs-type,
      .hljs-class .hljs-title {
        color: #ffa657;
        font-weight: bold;
      }
      .hljs-tag,
      .hljs-name,
      .hljs-attribute {
        color: #7ee787;
        font-weight: normal;
      }
      .hljs-regexp,
      .hljs-link {
        color: #a5d6ff;
      }
      .hljs-symbol,
      .hljs-bullet {
        color: #f85149;
      }
      .hljs-built_in,
      .hljs-builtin-name {
        color: #79c0ff;
      }
      .hljs-meta {
        color: #8b949e;
        font-weight: bold;
      }
      .hljs-deletion {
        background: #ffeef0;
      }
      .hljs-addition {
        background: #f0fff4;
      }
      .hljs-emphasis {
        font-style: italic;
      }
      .hljs-strong {
        font-weight: bold;
      }
    `,
  },
  'vs-light': {
    name: 'vs-light',
    displayName: 'Visual Studio Light',
    mode: 'light',
    description: 'Visual Studio light theme',
    styles: `
      .hljs {
        display: block;
        overflow-x: auto;
        padding: 0.5em;
        background: white;
        color: black;
      }
      .hljs-comment,
      .hljs-quote,
      .hljs-variable {
        color: #008000;
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-built_in,
      .hljs-name,
      .hljs-tag {
        color: #00f;
      }
      .hljs-string,
      .hljs-title,
      .hljs-section,
      .hljs-attribute,
      .hljs-literal,
      .hljs-template-tag,
      .hljs-template-variable,
      .hljs-type,
      .hljs-addition {
        color: #a31515;
      }
      .hljs-deletion,
      .hljs-selector-attr,
      .hljs-selector-pseudo,
      .hljs-meta {
        color: #2b91af;
      }
      .hljs-doctag {
        color: #808080;
      }
      .hljs-attr {
        color: #f00;
      }
      .hljs-symbol,
      .hljs-bullet,
      .hljs-link {
        color: #00b0e8;
      }
      .hljs-emphasis {
        font-style: italic;
      }
      .hljs-strong {
        font-weight: bold;
      }
    `,
  },
  'monokai': {
    name: 'monokai',
    displayName: 'Monokai',
    mode: 'dark',
    description: 'Classic Monokai theme',
    styles: `
      .hljs {
        display: block;
        overflow-x: auto;
        padding: 0.5em;
        background: #272822;
        color: #ddd;
      }
      .hljs-tag,
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-literal,
      .hljs-strong,
      .hljs-name {
        color: #f92672;
      }
      .hljs-code {
        color: #66d9ef;
      }
      .hljs-class .hljs-title {
        color: white;
      }
      .hljs-attribute,
      .hljs-symbol,
      .hljs-regexp,
      .hljs-link {
        color: #bf79db;
      }
      .hljs-string,
      .hljs-bullet,
      .hljs-subst,
      .hljs-title,
      .hljs-section,
      .hljs-emphasis,
      .hljs-type,
      .hljs-built_in,
      .hljs-builtin-name,
      .hljs-selector-attr,
      .hljs-selector-pseudo,
      .hljs-addition,
      .hljs-variable,
      .hljs-template-tag,
      .hljs-template-variable {
        color: #a6e22e;
      }
      .hljs-comment,
      .hljs-quote,
      .hljs-deletion,
      .hljs-meta {
        color: #75715e;
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-literal,
      .hljs-doctag,
      .hljs-title,
      .hljs-section,
      .hljs-type,
      .hljs-selector-id {
        font-weight: bold;
      }
    `,
  },
};

// Theme mappings for common DaisyUI themes
export const DAISY_THEME_MAPPINGS: Record<string, string> = {
  // Light themes
  'light': 'github-light',
  'corporate': 'vs-light',
  'emerald': 'github-light',
  'fantasy': 'github-light',
  'garden': 'github-light',
  'cupcake': 'github-light',
  'bumblebee': 'github-light',
  'retro': 'vs-light',
  'valentine': 'github-light',

  // Dark themes
  'dark': 'github-dark',
  'black': 'github-dark',
  'forest': 'monokai',
  'aqua': 'github-dark',
  'luxury': 'monokai',
  'dracula': 'monokai',
  'synthwave': 'monokai',
  'halloween': 'monokai',
  'coffee': 'monokai',
  'dim': 'github-dark',
  'night': 'github-dark',
  'sunset': 'github-dark',
  'business': 'github-dark',
} as const;

export class SimpleSyntaxThemeManager {
  private static instance: SimpleSyntaxThemeManager;
  private currentTheme: string | null = null;
  private styleElement: HTMLStyleElement | null = null;

  private constructor() {}

  static getInstance(): SimpleSyntaxThemeManager {
    if (!SimpleSyntaxThemeManager.instance) {
      SimpleSyntaxThemeManager.instance = new SimpleSyntaxThemeManager();
    }
    return SimpleSyntaxThemeManager.instance;
  }

  /**
   * Load a syntax theme by injecting CSS styles
   */
  async loadTheme(themeName: string): Promise<void> {
    const theme = SYNTAX_THEMES[themeName];
    if (!theme) {
      throw new Error(`Theme ${themeName} not found`);
    }

    try {
      // Remove existing style element if any
      if (this.styleElement) {
        this.styleElement.remove();
      }

      // Create new style element
      this.styleElement = document.createElement('style');
      this.styleElement.id = 'syntax-theme-styles';
      this.styleElement.textContent = theme.styles;

      // Add to document head
      document.head.appendChild(this.styleElement);

      this.currentTheme = themeName;
    } catch (error) {
      console.error(`Failed to load syntax theme ${themeName}:`, error);
      throw error;
    }
  }

  /**
   * Get the appropriate syntax theme for a DaisyUI theme
   */
  getThemeForDaisyUI(daisyTheme: string): string {
    return DAISY_THEME_MAPPINGS[daisyTheme] || 'github-light';
  }

  /**
   * Auto-detect and load theme based on current DaisyUI theme
   */
  async autoLoadTheme(): Promise<void> {
    // Try to detect current DaisyUI theme
    const htmlElement = document.documentElement;
    const currentDaisyTheme = htmlElement.getAttribute('data-theme') || 'light';
    
    const syntaxTheme = this.getThemeForDaisyUI(currentDaisyTheme);
    await this.loadTheme(syntaxTheme);
  }

  /**
   * Get all available themes
   */
  getAvailableThemes(): SyntaxTheme[] {
    return Object.values(SYNTAX_THEMES);
  }

  /**
   * Get current theme name
   */
  getCurrentTheme(): string | null {
    return this.currentTheme;
  }

  /**
   * Set up theme change listener for DaisyUI theme changes
   */
  setupThemeChangeListener(): void {
    // Create a MutationObserver to watch for theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          this.autoLoadTheme().catch(console.error);
        }
      });
    });

    // Start observing the document element for attribute changes
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }
}

// Export singleton instance
export const simpleSyntaxThemeManager = SimpleSyntaxThemeManager.getInstance();

// Utility function to initialize theme system
export async function initializeSyntaxThemes(): Promise<void> {
  try {
    await simpleSyntaxThemeManager.autoLoadTheme();
    simpleSyntaxThemeManager.setupThemeChangeListener();
  } catch (error) {
    console.error('Failed to initialize syntax themes:', error);
    // Fallback to default theme
    try {
      await simpleSyntaxThemeManager.loadTheme('github-light');
    } catch (fallbackError) {
      console.error('Failed to load fallback theme:', fallbackError);
    }
  }
}
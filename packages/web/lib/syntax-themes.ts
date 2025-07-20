// ABOUTME: Syntax highlighting theme management with support for light/dark modes
// ABOUTME: Provides theme switching and CSS loading for highlight.js

export interface SyntaxTheme {
  name: string;
  displayName: string;
  mode: 'light' | 'dark';
  cssPath: string;
  description: string;
}

// Available syntax highlighting themes
export const SYNTAX_THEMES: Record<string, SyntaxTheme> = {
  // Light themes
  'github-light': {
    name: 'github-light',
    displayName: 'GitHub Light',
    mode: 'light',
    cssPath: 'highlight.js/styles/github.css',
    description: 'Clean GitHub-style light theme',
  },
  'vs': {
    name: 'vs',
    displayName: 'Visual Studio',
    mode: 'light',
    cssPath: 'highlight.js/styles/vs.css',
    description: 'Visual Studio light theme',
  },
  'default': {
    name: 'default',
    displayName: 'Default Light',
    mode: 'light',
    cssPath: 'highlight.js/styles/default.css',
    description: 'Default highlight.js light theme',
  },
  'stackoverflow-light': {
    name: 'stackoverflow-light',
    displayName: 'StackOverflow Light',
    mode: 'light',
    cssPath: 'highlight.js/styles/stackoverflow-light.css',
    description: 'StackOverflow-style light theme',
  },

  // Dark themes
  'github-dark': {
    name: 'github-dark',
    displayName: 'GitHub Dark',
    mode: 'dark',
    cssPath: 'highlight.js/styles/github-dark.css',
    description: 'GitHub-style dark theme',
  },
  'vs2015': {
    name: 'vs2015',
    displayName: 'Visual Studio 2015',
    mode: 'dark',
    cssPath: 'highlight.js/styles/vs2015.css',
    description: 'Visual Studio 2015 dark theme',
  },
  'atom-one-dark': {
    name: 'atom-one-dark',
    displayName: 'Atom One Dark',
    mode: 'dark',
    cssPath: 'highlight.js/styles/atom-one-dark.css',
    description: 'Popular Atom One Dark theme',
  },
  'monokai': {
    name: 'monokai',
    displayName: 'Monokai',
    mode: 'dark',
    cssPath: 'highlight.js/styles/monokai.css',
    description: 'Classic Monokai theme',
  },
  'tomorrow-night': {
    name: 'tomorrow-night',
    displayName: 'Tomorrow Night',
    mode: 'dark',
    cssPath: 'highlight.js/styles/tomorrow-night.css',
    description: 'Tomorrow Night theme',
  },
} as const;

// Theme mappings for common DaisyUI themes
export const DAISY_THEME_MAPPINGS: Record<string, string> = {
  // Light themes
  'light': 'github-light',
  'corporate': 'vs',
  'emerald': 'github-light',
  'fantasy': 'default',
  'garden': 'github-light',
  'lofi': 'stackoverflow-light',
  'pastel': 'github-light',
  'wireframe': 'vs',
  'cmyk': 'default',
  'autumn': 'github-light',
  'acid': 'github-light',
  'lemonade': 'github-light',
  'winter': 'github-light',
  'nord': 'github-light',
  'cupcake': 'github-light',
  'bumblebee': 'github-light',
  'retro': 'stackoverflow-light',
  'valentine': 'github-light',

  // Dark themes
  'dark': 'github-dark',
  'black': 'atom-one-dark',
  'forest': 'monokai',
  'aqua': 'vs2015',
  'luxury': 'atom-one-dark',
  'dracula': 'monokai',
  'synthwave': 'tomorrow-night',
  'halloween': 'atom-one-dark',
  'coffee': 'monokai',
  'dim': 'github-dark',
  'night': 'tomorrow-night',
  'sunset': 'vs2015',
  'business': 'atom-one-dark',
} as const;

export class SyntaxThemeManager {
  private static instance: SyntaxThemeManager;
  private currentTheme: string | null = null;
  private loadedThemes = new Set<string>();

  private constructor() {}

  static getInstance(): SyntaxThemeManager {
    if (!SyntaxThemeManager.instance) {
      SyntaxThemeManager.instance = new SyntaxThemeManager();
    }
    return SyntaxThemeManager.instance;
  }

  /**
   * Load a syntax theme CSS file
   */
  async loadTheme(themeName: string): Promise<void> {
    if (this.loadedThemes.has(themeName)) {
      return;
    }

    const theme = SYNTAX_THEMES[themeName];
    if (!theme) {
      throw new Error(`Theme ${themeName} not found`);
    }

    try {
      // Remove existing theme if any
      if (this.currentTheme) {
        this.removeTheme(this.currentTheme);
      }

      // Create and load new theme
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `/node_modules/${theme.cssPath}`;
      link.id = `syntax-theme-${themeName}`;
      link.setAttribute('data-syntax-theme', themeName);

      // Add to document head
      document.head.appendChild(link);

      // Wait for the CSS to load
      await new Promise<void>((resolve, reject) => {
        link.onload = () => resolve();
        link.onerror = () => reject(new Error(`Failed to load theme ${themeName}`));
      });

      this.currentTheme = themeName;
      this.loadedThemes.add(themeName);
    } catch (error) {
      console.error(`Failed to load syntax theme ${themeName}:`, error);
      throw error;
    }
  }

  /**
   * Remove a theme from the document
   */
  removeTheme(themeName: string): void {
    const existingLink = document.getElementById(`syntax-theme-${themeName}`);
    if (existingLink) {
      existingLink.remove();
    }
    this.loadedThemes.delete(themeName);
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
   * Get themes by mode (light/dark)
   */
  getThemesByMode(mode: 'light' | 'dark'): SyntaxTheme[] {
    return Object.values(SYNTAX_THEMES).filter(theme => theme.mode === mode);
  }

  /**
   * Check if a theme is loaded
   */
  isThemeLoaded(themeName: string): boolean {
    return this.loadedThemes.has(themeName);
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
export const syntaxThemeManager = SyntaxThemeManager.getInstance();

// Utility function to initialize theme system
export async function initializeSyntaxThemes(): Promise<void> {
  try {
    await syntaxThemeManager.autoLoadTheme();
    syntaxThemeManager.setupThemeChangeListener();
  } catch (error) {
    console.error('Failed to initialize syntax themes:', error);
    // Fallback to default theme
    try {
      await syntaxThemeManager.loadTheme('github-light');
    } catch (fallbackError) {
      console.error('Failed to load fallback theme:', fallbackError);
    }
  }
}
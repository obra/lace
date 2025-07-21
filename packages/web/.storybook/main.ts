import type { StorybookConfig } from '@storybook/nextjs-vite';
import path from 'path';

const config: StorybookConfig = {
  stories: ['../components/**/*.stories.@(js|jsx|ts|tsx|mdx)'],
  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-docs',
    '@storybook/addon-a11y',
  ],
  framework: {
    name: '@storybook/nextjs-vite',
    options: {},
  },
  docs: {
    autodocs: true,
    defaultName: 'Docs',
  },
  staticDirs: ['../public'],
  viteFinal: async (config) => {
    // Replicate the path aliases from next.config.ts
    config.resolve!.alias = {
      ...config.resolve!.alias,
      '~': path.resolve(process.cwd(), '../../src'),
      '@': path.resolve(process.cwd(), '.'),
    };

    // Handle Node.js dependencies that might not be available in browser
    config.define = {
      ...config.define,
      global: 'globalThis',
    };

    // Optimize dependencies and enable code splitting
    config.optimizeDeps = {
      ...config.optimizeDeps,
      include: [
        'openai',
        '@mdx-js/react',
        '@fortawesome/react-fontawesome',
        '@fortawesome/fontawesome-svg-core',
        '@fortawesome/free-solid-svg-icons',
        '@storybook/addon-a11y/preview',
        '@storybook/nextjs-vite',
        '@testing-library/react',
        'framer-motion',
        'react',
        'react-dom',
        'react-dom/client',
        'markdown-to-jsx',
      ],
      exclude: [
        // Exclude heavy dependencies that can be lazy-loaded
        'cli-highlight',
      ],
    };

    // Enable code splitting and performance optimizations
    config.build = {
      ...config.build,
      rollupOptions: {
        ...config.build?.rollupOptions,
        output: {
          ...config.build?.rollupOptions?.output,
          // Enable manual chunking for better code splitting
          manualChunks: {
            // Vendor chunk for core libraries
            vendor: ['react', 'react-dom'],
            // UI library chunk
            ui: ['@headlessui/react', '@heroicons/react', 'framer-motion'],
            // FontAwesome chunk
            icons: [
              '@fortawesome/react-fontawesome',
              '@fortawesome/fontawesome-svg-core',
              '@fortawesome/free-solid-svg-icons',
            ],
            // Syntax highlighting chunk (lazy-loaded)
            'syntax-highlighting': ['highlight.js/lib/core', 'cli-highlight'],
          },
        },
      },
      // Optimize chunk size
      chunkSizeWarningLimit: 1000,
    };

    // Set server config for better development experience
    config.server = {
      ...config.server,
      fs: {
        ...config.server?.fs,
        allow: ['..', '.'],
      },
    };

    return config;
  },
  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) => (prop.parent ? !/node_modules/.test(prop.parent.fileName) : true),
      skipChildrenPropWithoutDoc: false,
    },
  },
};

export default config;

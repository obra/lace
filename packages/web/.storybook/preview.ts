import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';
import '../app/globals.css';
import { dmSans, lato, jetBrainsMono } from '../app/fonts';
import { withTennisCommentary } from './decorators/tennis-commentary';

// Performance optimization: Lazy load heavy dependencies
const lazyImports = {
  syntaxHighlighting: () => import('highlight.js/lib/core'),
  framerMotion: () => import('framer-motion'),
};

const preview: Preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
      expanded: true,
      sort: 'alpha',
    },
    docs: {
      toc: true,
      autodocs: true,
      defaultName: 'Documentation',
      story: {
        inline: true,
        height: '400px',
      },
    },
    options: {
      storySort: {
        order: [
          'Overview',
          'Design System',
          'Atoms',
          'Molecules',
          'Organisms',
          'Templates',
          'Pages',
          '*',
        ],
      },
    },
    // Performance optimizations
    chromatic: {
      // Reduce visual diff noise
      delay: 300,
      // Optimize for performance
      modes: {
        light: {
          theme: 'light',
          backgrounds: { default: 'light' },
        },
        dark: {
          theme: 'dark',
          backgrounds: { default: 'dark' },
        },
      },
      // Disable for heavy components during development
      disable: process.env.NODE_ENV === 'development',
      // Skip stories that are too complex for visual regression
      skip: ['Pages/LaceApp--interactive-demo', 'Pages/AnimatedLaceApp--interactive-demo'],
    },
    // Layout optimization
    layout: 'centered',
    viewport: {
      viewports: {
        mobile: {
          name: 'Mobile',
          styles: {
            width: '375px',
            height: '667px',
          },
        },
        tablet: {
          name: 'Tablet',
          styles: {
            width: '768px',
            height: '1024px',
          },
        },
        desktop: {
          name: 'Desktop',
          styles: {
            width: '1200px',
            height: '800px',
          },
        },
      },
    },
    a11y: {
      test: 'todo',
    },
  },
  globalTypes: {
    theme: {
      name: 'Theme',
      description: 'DaisyUI theme',
      defaultValue: 'light',
      toolbar: {
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
          { value: 'cupcake', title: 'Cupcake' },
          { value: 'synthwave', title: 'Synthwave' },
        ],
      },
    },
    tennisCommentary: {
      name: 'Tennis Commentary',
      description: 'Enable tennis-style commentary for component interactions',
      defaultValue: false,
      toolbar: {
        icon: 'speaker',
        items: [
          { value: false, title: 'Off' },
          { value: true, title: 'On' },
        ],
      },
    },
  },
  decorators: [
    // Performance decorator - lazy load heavy dependencies
    (Story, context) => {
      const storyId = context.id;
      const isAnimatedStory = storyId.includes('animated') || storyId.includes('motion');
      const isCodeStory = storyId.includes('code') || storyId.includes('syntax');

      // Preload dependencies based on story type
      if (isAnimatedStory) {
        lazyImports.framerMotion().catch(() => {});
      }
      if (isCodeStory) {
        lazyImports.syntaxHighlighting().catch(() => {});
      }

      return React.createElement(Story);
    },
    // Theme decorator
    (Story, context) => {
      const theme = context.globals.theme;
      return React.createElement(
        'div',
        {
          'data-theme': theme,
          className: `${dmSans.className} ${dmSans.variable} ${lato.variable} ${jetBrainsMono.variable} min-h-screen bg-base-100 text-base-content`,
        },
        React.createElement(Story)
      );
    },
    // Tennis commentary decorator
    (Story, context) => {
      const enableCommentary = context.globals.tennisCommentary;
      if (enableCommentary) {
        return React.createElement(withTennisCommentary, {}, Story);
      }
      return React.createElement(Story);
    },
  ],
};

export default preview;

import { fileURLToPath } from 'node:url';

export default {
  stories: [
    'components/ui/Badge.stories.*',
    'components/ui/Modal.stories.*',
    'components/ui/CodeBlock.stories.*',
    'components/ui/Avatar.stories.*',
    'components/ui/StatusDot.stories.*',
    'components/ui/LoadingDots.stories.*',
    'components/ui/SkeletonLoader.stories.*',
    'components/ui/LoadingSkeleton.stories.*',
    'components/ui/IconButton.stories.*',
    'components/ui/InlineCode.stories.*',
    'components/ui/Carousel.stories.*',
  ],
  addons: {
    a11y: {
      enabled: true,
    },
  },
  viteConfig: {
    resolve: {
      alias: {
        '~': fileURLToPath(new URL('../core/src', import.meta.url)),
        '@': fileURLToPath(new URL('.', import.meta.url)),
      },
    },
  },
};

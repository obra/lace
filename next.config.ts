import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Output directory for Next.js build
  distDir: '.next',

  // TypeScript configuration
  typescript: {
    ignoreBuildErrors: false,
  },

  // ESLint configuration
  eslint: {
    ignoreDuringBuilds: false,
    dirs: ['src/interfaces/web/app', 'src/interfaces/web/components', 'src/interfaces/web/lib'],
  },

  // Use webpack alias to support ~/* imports
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '~': new URL('./src', import.meta.url).pathname,
    };
    // Support .js/.jsx imports resolving to .ts/.tsx files
    config.resolve.extensionAlias = {
      '.js': ['.js', '.ts'],
      '.jsx': ['.jsx', '.tsx'],
    };
    return config;
  },

  // Enable custom server mode (important for embedding)
  output: 'standalone',

  // Enable React strict mode
  reactStrictMode: true,

  // Configure external packages for server components
  serverExternalPackages: [],
};

export default nextConfig;

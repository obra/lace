import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Output directory for Next.js build
  distDir: '.next',
  
  // Use webpack alias to support ~/* imports
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '~': new URL('./src', import.meta.url).pathname,
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
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
  
  // Disable telemetry for embedded use
  telemetry: false,

  // Enable React strict mode
  reactStrictMode: true,

  // Configure for local development and embedded usage
  experimental: {
    // Allow server components in embedded mode
    serverComponentsExternalPackages: [],
  },
};

export default nextConfig;
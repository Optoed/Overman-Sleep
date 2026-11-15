import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Keep verification builds separate from the running development server.
  distDir: process.env.OVERMAN_VERIFY_BUILD === '1' ? '.next-check' : '.next',
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1'],
  devIndicators: false,
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ] }];
  },
};
export default config;

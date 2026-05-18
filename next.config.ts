import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Tillad Cloudflare Tunnel-URLs som dev-origin (til at dele localhost
  // med venner via `cloudflared tunnel --url http://localhost:3010`).
  allowedDevOrigins: ['*.trycloudflare.com'],
  experimental: {
    serverActions: {
      bodySizeLimit: '15mb',
    },
  },
};

export default nextConfig;

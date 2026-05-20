import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Required for Railway deployment with managed Postgres / volumes.
  // Lineage: inbound-tracker commit ec15a33.
  output: 'standalone',
};

export default nextConfig;

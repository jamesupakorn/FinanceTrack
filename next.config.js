/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ['js', 'jsx', 'ts', 'tsx'],
  experimental: {
    appDir: false
  },
  // กำหนด path สำหรับ pages directory
  async rewrites() {
    return [
      {
        source: '/:path*',
        destination: '/src/frontend/pages/:path*'
      }
    ];
  }
};

module.exports = nextConfig;
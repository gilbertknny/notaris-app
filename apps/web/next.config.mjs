const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** Header keamanan untuk semua halaman (lihat tab Frontend → Keamanan). */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Monorepo: sertakan paket workspace (@notaris/shared) di build standalone.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@notaris/shared'],
  poweredByHeader: false,
  // API diakses lewat origin yang sama, sehingga cookie sesi bisa SameSite=Strict.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

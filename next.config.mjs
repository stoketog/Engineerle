/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pure client-side game for v1: export as static files (host anywhere, e.g. Vercel, Netlify, S3).
  output: 'export',
};
export default nextConfig;

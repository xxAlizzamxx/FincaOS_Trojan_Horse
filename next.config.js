/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      // Fotos de perfil de Google (registro con Google)
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
  // En Next.js 13 serverActions se habilita con `true`.
  // La forma objeto { bodySizeLimit } solo existe en Next.js 14+.
  experimental: {
    serverActions: true,
  },
};

module.exports = nextConfig;

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
      { protocol: 'https', hostname: '*.googleusercontent.com' },
    ],
  },
  // Aumentar el límite del body parser para Route Handlers y Server Actions.
  // Sin esto, multipart/form-data de archivos grandes es rechazado por Next.js
  // antes de llegar al handler (error 413 desde el propio servidor de Next.js).
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

module.exports = nextConfig;

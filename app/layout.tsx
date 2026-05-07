import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { Providers } from '@/components/Providers';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'FincaOS — Gestión de tu comunidad',
  description: 'La plataforma digital para comunidades de propietarios en España.',
  manifest: '/manifest.json',
  icons: {
    icon: '/navegador.png',
    shortcut: '/navegador.png',
    apple: '/navegador.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <meta name="theme-color" content="#FF6E61" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className={inter.className}>
        <Providers>
          {children}
        </Providers>
        <Toaster
          position="top-center"
          closeButton
          toastOptions={{ className: 'max-w-lg mx-auto' }}
        />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

'use client';

import { ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { AuthProvider } from '@/hooks/useAuth';
import { SoundProvider } from '@/components/SoundProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" forcedTheme="light">
      <AuthProvider>
        <SoundProvider>
          {children}
        </SoundProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/hooks/useAuth';
import { SoundProvider } from '@/components/SoundProvider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SoundProvider>
        {children}
      </SoundProvider>
    </AuthProvider>
  );
}

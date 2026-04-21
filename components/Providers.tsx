'use client';

import { ReactNode } from 'react';
import { AuthProvider } from '@/hooks/useAuth';
import { SoundProvider } from '@/components/SoundProvider';
import { AIChatProvider } from '@/contexts/AIChatContext';
import { AIAssistant } from '@/components/ai/AIAssistant';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <SoundProvider>
        <AIChatProvider>
          {children}
          <AIAssistant />
        </AIChatProvider>
      </SoundProvider>
    </AuthProvider>
  );
}

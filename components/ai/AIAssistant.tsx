'use client';

import { useState } from 'react';
import { FloatingAIButton } from './FloatingAIButton';
import { AIChatPanel } from './AIChatPanel';
import { useAuth } from '@/hooks/useAuth';

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const { perfil } = useAuth();

  if (!perfil) return null;

  return (
    <>
      <FloatingAIButton onClick={() => setIsOpen(!isOpen)} />
      <AIChatPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

'use client';

import { useState } from 'react';
import { FloatingAIButton } from './FloatingAIButton';
import { AIChatPanel } from './AIChatPanel';

export function AIAssistant() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <FloatingAIButton onClick={() => setIsOpen(!isOpen)} />
      <AIChatPanel isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}

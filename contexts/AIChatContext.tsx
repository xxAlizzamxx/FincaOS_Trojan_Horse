'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useAIChat, type AIMessage } from '@/hooks/useAIChat';

export type { AIMessage };

interface AIChatContextType {
  messages: AIMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

const AIChatContext = createContext<AIChatContextType | null>(null);

export function AIChatProvider({ children }: { children: ReactNode }) {
  const aiChat = useAIChat();

  return <AIChatContext.Provider value={aiChat}>{children}</AIChatContext.Provider>;
}

export function useAIChatContext() {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChatContext must be used within AIChatProvider');
  }
  return context;
}

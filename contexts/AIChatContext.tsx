'use client';

import { createContext, useContext, ReactNode, useState, useCallback } from 'react';

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
}

interface AIChatContextType {
  messages: AIMessage[];
  loading: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

const AIChatContext = createContext<AIChatContextType | null>(null);

export function AIChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim()) return;
    
    const userMsg: AIMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Simulate AI response for now
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const aiMsg: AIMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: 'Got it. I\'ll help you with that.',
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error('Error sending message:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <AIChatContext.Provider value={{ messages, loading, sendMessage, clearMessages }}>
      {children}
    </AIChatContext.Provider>
  );
}

export function useAIChatContext() {
  const context = useContext(AIChatContext);
  if (!context) {
    throw new Error('useAIChatContext must be used within AIChatProvider');
  }
  return context;
}

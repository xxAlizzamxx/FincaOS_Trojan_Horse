'use client';

import { MessageCircle } from 'lucide-react';
import { useState } from 'react';

interface FloatingAIButtonProps {
  onClick: () => void;
}

export function FloatingAIButton({ onClick }: FloatingAIButtonProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="fixed bottom-4 right-4 w-14 h-14 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg transition-all duration-300 flex items-center justify-center"
      style={{
        zIndex: 9999,
        transform: isHovered ? 'scale(1.1)' : 'scale(1)',
        boxShadow: isHovered 
          ? '0 20px 25px -5px rgba(249, 115, 22, 0.4)' 
          : '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
      }}
      title="Open AI Assistant"
      aria-label="Open AI Assistant"
    >
      <MessageCircle className="w-6 h-6" />
    </button>
  );
}

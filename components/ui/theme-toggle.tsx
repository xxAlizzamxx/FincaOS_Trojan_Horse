'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="w-9 h-9 rounded-xl flex items-center justify-center bg-muted hover:bg-accent transition-colors"
      aria-label="Toggle theme"
    >
      {theme === 'dark'
        ? <Sun className="w-4 h-4 text-yellow-500" />
        : <Moon className="w-4 h-4 text-muted-foreground" />
      }
    </button>
  );
}

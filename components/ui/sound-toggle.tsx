'use client';

/**
 * SoundToggle — botón para activar/desactivar el sonido.
 * Se puede usar en AppHeader, BottomTabBar o en cualquier pantalla de ajustes.
 *
 * Props opcionales:
 *  · size    → 'sm' | 'md' (default 'md')
 *  · variant → 'ghost' | 'outline' | 'icon-only' (default 'ghost')
 *  · showLabel → mostrar texto junto al icono (default false)
 */

import { Volume2, VolumeX } from 'lucide-react';
import { useSound } from '@/hooks/useSound';
import { cn } from '@/lib/utils';

interface SoundToggleProps {
  size?:      'sm' | 'md';
  variant?:   'ghost' | 'outline' | 'icon-only';
  showLabel?: boolean;
  className?: string;
}

export function SoundToggle({
  size      = 'md',
  variant   = 'ghost',
  showLabel = false,
  className,
}: SoundToggleProps) {
  const { enabled, toggle } = useSound();

  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  const baseClass = cn(
    'flex items-center gap-1.5 rounded-xl transition-all duration-200 select-none',
    size === 'sm' ? 'p-1.5' : 'p-2',
    variant === 'outline' && 'border border-border hover:border-finca-coral/40',
    variant === 'ghost'   && 'hover:bg-muted/60',
    enabled
      ? 'text-finca-coral'
      : 'text-muted-foreground hover:text-foreground',
    className,
  );

  return (
    <button
      onClick={toggle}
      className={baseClass}
      aria-label={enabled ? 'Desactivar sonido' : 'Activar sonido'}
      title={enabled ? 'Desactivar sonido' : 'Activar sonido'}
    >
      {enabled
        ? <Volume2 className={iconSize} />
        : <VolumeX  className={iconSize} />}

      {showLabel && (
        <span className="text-xs font-medium">
          {enabled ? 'Sonido' : 'Silencio'}
        </span>
      )}
    </button>
  );
}

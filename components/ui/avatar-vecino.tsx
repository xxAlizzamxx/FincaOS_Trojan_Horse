'use client';

/**
 * AvatarVecino — muestra la foto de Google del vecino con fallback a iniciales.
 *
 * - Si avatar_url existe: muestra la foto real
 * - Si falla la carga o no hay URL: muestra las iniciales con el color del rol
 * - El ring exterior siempre refleja el rol (independientemente de si hay foto)
 *
 * referrerPolicy="no-referrer" es obligatorio para imágenes de Google:
 * sin él el navegador envía el Referer y Google puede bloquear la carga.
 */

import { useState } from 'react';
import { cn }       from '@/lib/utils';
import type { Perfil } from '@/types/database';

/* Configuración visual por rol */
const ROL_AVATAR: Record<string, { bg: string; text: string; ring: string }> = {
  presidente: { bg: 'bg-finca-peach/60',   text: 'text-finca-coral',     ring: 'ring-finca-coral/70'  },
  admin:      { bg: 'bg-finca-coral',       text: 'text-white',           ring: 'ring-finca-coral'     },
  mediador:   { bg: 'bg-violet-100',        text: 'text-violet-700',      ring: 'ring-violet-400'      },
  vecino:     { bg: 'bg-muted',             text: 'text-muted-foreground',ring: 'ring-gray-300'        },
};

const SIZE: Record<string, string> = {
  sm:  'w-9  h-9  text-xs',
  md:  'w-11 h-11 text-sm',
  lg:  'w-14 h-14 text-base',
};

function iniciales(nombre: string): string {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

interface AvatarVecinoProps {
  perfil: Pick<Perfil, 'nombre_completo' | 'rol' | 'avatar_url'>;
  size?:  'sm' | 'md' | 'lg';
  className?: string;
}

export function AvatarVecino({ perfil, size = 'md', className }: AvatarVecinoProps) {
  const [imgError, setImgError] = useState(false);

  const cfg      = ROL_AVATAR[perfil.rol] ?? ROL_AVATAR.vecino;
  const hasPhoto = !!perfil.avatar_url && !imgError;

  return (
    <div
      className={cn(
        'rounded-full shrink-0 ring-2 overflow-hidden flex items-center justify-center font-bold',
        SIZE[size],
        cfg.ring,
        !hasPhoto && cfg.bg,
        !hasPhoto && cfg.text,
        className,
      )}
    >
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={perfil.avatar_url!}
          alt={perfil.nombre_completo}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <span>{iniciales(perfil.nombre_completo)}</span>
      )}
    </div>
  );
}

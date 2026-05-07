'use client';

import { Trash2, CheckCircle2, Bell, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

export type AccionMasiva =
  | 'resolver'
  | 'marcar_en_revision'
  | 'cambiar_prioridad_urgente'
  | 'notificar_afectados'
  | 'eliminar';

interface Props {
  count: number;
  onAccion: (accion: AccionMasiva) => void;
  onCancelar: () => void;
}

export function AccionesMasivasBar({ count, onAccion, onCancelar }: Props) {
  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-finca-dark text-white rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-medium flex-1 min-w-0 truncate">
          {count} seleccionada{count !== 1 ? 's' : ''}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              className="bg-white text-finca-dark hover:bg-white/90 h-8 px-3 text-xs font-semibold shrink-0"
            >
              Acciones ▾
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem onClick={() => onAccion('resolver')}>
              <CheckCircle2 className="w-4 h-4 mr-2 text-green-600" />
              Marcar resueltas
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAccion('marcar_en_revision')}>
              <ArrowRight className="w-4 h-4 mr-2 text-blue-600" />
              Pasar a revisión
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAccion('cambiar_prioridad_urgente')}>
              <span className="mr-2 text-base leading-none">🚨</span>
              Marcar urgentes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAccion('notificar_afectados')}>
              <Bell className="w-4 h-4 mr-2 text-finca-coral" />
              Notificar afectados
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onAccion('eliminar')}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Eliminar selección
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          onClick={onCancelar}
          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors shrink-0"
          aria-label="Cancelar selección"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

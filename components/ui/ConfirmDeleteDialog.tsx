'use client';

/**
 * ConfirmDeleteDialog
 *
 * Diálogo de confirmación reutilizable para acciones destructivas.
 * Se conecta con useEliminar() a través de dialogProps:
 *
 *   const { confirmar, dialogProps } = useEliminar();
 *   <ConfirmDeleteDialog {...dialogProps} />
 *
 * Características:
 *   - Icono de advertencia visible
 *   - Muestra el nombre del elemento a eliminar
 *   - Botón de confirmación rojo con spinner mientras elimina
 *   - No se puede cerrar con Escape ni clic fuera mientras elimina
 */

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDeleteDialogProps {
  open       : boolean;
  /** Nombre descriptivo del elemento (se muestra entre comillas) */
  nombre     : string;
  /** true mientras el fetch está en curso */
  eliminando : boolean;
  onConfirm  : () => Promise<void>;
  onCancel   : () => void;
}

export function ConfirmDeleteDialog({
  open,
  nombre,
  eliminando,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogProps) {
  return (
    <AlertDialog
      open={open}
      /* Bloquear cierre externo mientras elimina */
      onOpenChange={(o) => { if (!o && !eliminando) onCancel(); }}
    >
      <AlertDialogContent className="max-w-xs rounded-2xl p-6">
        <AlertDialogHeader className="items-center text-center gap-3">
          {/* Icono de advertencia */}
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-7 h-7 text-red-600" />
          </div>

          <div className="space-y-1">
            <AlertDialogTitle className="text-base">
              ¿Eliminar este elemento?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-center leading-relaxed">
              Estás a punto de eliminar{' '}
              <span className="font-semibold text-foreground break-words">
                &ldquo;{nombre}&rdquo;
              </span>
              .<br />
              <span className="text-red-600 font-medium">Esta acción es irreversible.</span>
            </AlertDialogDescription>
          </div>
        </AlertDialogHeader>

        <AlertDialogFooter className="mt-2 flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="w-full sm:flex-1"
            disabled={eliminando}
            onClick={onCancel}
          >
            Cancelar
          </Button>

          <Button
            className="w-full sm:flex-1 bg-red-600 hover:bg-red-700 text-white"
            disabled={eliminando}
            onClick={onConfirm}
          >
            {eliminando ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Eliminando…
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Eliminar
              </>
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

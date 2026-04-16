'use client';

/**
 * useEliminar
 *
 * Hook genérico para eliminar cualquier entidad de la app.
 * Gestiona:
 *   - Estado del diálogo de confirmación
 *   - Obtención automática del token Firebase
 *   - Llamada al endpoint DELETE /api/eliminar/:tipo/:id
 *   - Feedback al usuario (toast)
 *   - Callback onExito para actualizar el estado local sin recargar la página
 *
 * Uso:
 *   const { confirmar, dialogProps } = useEliminar();
 *
 *   // Abrir el diálogo:
 *   confirmar({ tipo: 'incidencia', id: inc.id, nombre: inc.titulo, onExito: () => setIncidencias(prev => prev.filter(i => i.id !== inc.id)) });
 *
 *   // En el JSX:
 *   <ConfirmDeleteDialog {...dialogProps} />
 */

import { useState }      from 'react';
import { toast }         from 'sonner';
import { getAuth }       from 'firebase/auth';

/* ─── Tipos públicos ─── */

export type TipoEliminable =
  | 'incidencia'
  | 'cuota'
  | 'documento'
  | 'anuncio'
  | 'votacion';

export interface ConfigEliminar {
  /** Tipo de entidad — debe coincidir con los keys del endpoint */
  tipo    : TipoEliminable;
  /** ID del documento Firestore */
  id      : string;
  /** Nombre descriptivo que se muestra en el diálogo (ej: título de la incidencia) */
  nombre  : string;
  /** Callback que se ejecuta solo si la eliminación fue exitosa */
  onExito : () => void;
}

export interface DialogEliminarProps {
  open       : boolean;
  nombre     : string;
  eliminando : boolean;
  onConfirm  : () => Promise<void>;
  onCancel   : () => void;
}

export interface UseEliminarResult {
  /** Abre el diálogo de confirmación con la config del elemento a eliminar */
  confirmar   : (config: ConfigEliminar) => void;
  /** Props listas para pasar directamente a <ConfirmDeleteDialog /> */
  dialogProps : DialogEliminarProps;
}

/* ─── Hook ─── */

export function useEliminar(): UseEliminarResult {
  const [pendiente, setPendiente]   = useState<ConfigEliminar | null>(null);
  const [eliminando, setEliminando] = useState(false);

  /* Abre el diálogo */
  function confirmar(config: ConfigEliminar) {
    setPendiente(config);
  }

  /* Cierra sin eliminar */
  function cancelar() {
    if (eliminando) return; // no permitir cancelar mientras elimina
    setPendiente(null);
  }

  /* Ejecuta la eliminación contra el API route */
  async function ejecutar(): Promise<void> {
    if (!pendiente) return;
    setEliminando(true);

    try {
      /* Obtener token actualizado del usuario autenticado */
      const auth  = getAuth();
      const token = await auth.currentUser?.getIdToken(/* forceRefresh */ false);
      if (!token) throw new Error('Sesión no encontrada. Por favor, vuelve a iniciar sesión.');

      const res = await fetch(`/api/eliminar/${pendiente.tipo}/${pendiente.id}`, {
        method  : 'DELETE',
        headers : { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Error ${res.status}`);
      }

      /* Actualizar UI de forma optimista — sin recargar la página */
      pendiente.onExito();
      setPendiente(null);
      toast.success('Eliminado correctamente');

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'No se pudo eliminar';
      toast.error(message);
    } finally {
      setEliminando(false);
    }
  }

  return {
    confirmar,
    dialogProps: {
      open       : !!pendiente,
      nombre     : pendiente?.nombre ?? '',
      eliminando,
      onConfirm  : ejecutar,
      onCancel   : cancelar,
    },
  };
}

/**
 * Cola offline con IndexedDB.
 * Guarda acciones cuando no hay red y las ejecuta al reconectarse.
 */

const DB_NAME   = 'fincaos-offline';
const DB_VERSION = 1;
const STORE      = 'pending-actions';

export type TipoAccionOffline =
  | 'crear_incidencia'
  | 'enviar_comentario'
  | 'marcar_afectado';

export interface AccionPendiente {
  id:        string;
  timestamp: number;
  tipo:      TipoAccionOffline;
  payload:   Record<string, unknown>;
  intentos:  number;
}

async function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function encolarAccion(
  accion: Omit<AccionPendiente, 'id' | 'timestamp' | 'intentos'>,
): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({
      ...accion,
      id:        crypto.randomUUID(),
      timestamp: Date.now(),
      intentos:  0,
    });
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function obtenerPendientes(): Promise<AccionPendiente[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as AccionPendiente[]);
    req.onerror   = () => reject(req.error);
  });
}

export async function eliminarAccion(id: string): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function procesarCola(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  const pendientes = await obtenerPendientes();
  for (const accion of pendientes) {
    try {
      await ejecutarAccion(accion);
      await eliminarAccion(accion.id);
    } catch {
      if (accion.intentos >= 3) {
        await eliminarAccion(accion.id);
      }
    }
  }
}

async function ejecutarAccion(accion: AccionPendiente): Promise<void> {
  // Implementar según tipo — por ahora log
  console.log('[OfflineQueue] ejecutando', accion.tipo, accion.payload);
}

// Inicializar listener al recuperar red (solo en browser)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void procesarCola();
  });
}

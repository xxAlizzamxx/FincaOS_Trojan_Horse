/**
 * Offline action queue backed by IndexedDB.
 *
 * Guarantees:
 *  - Each action has a unique `idempotency_key` (UUID set at enqueue time)
 *  - Status machine: pending → syncing → (deleted on success) | failed
 *  - `syncing` items are skipped by `procesarCola` → prevents double execution
 *    if `procesarCola` is called concurrently (e.g., multiple `online` events)
 *  - All write operations use idempotent Firestore calls (setDoc with fixed ID)
 *
 * DB versioning:
 *  v1 → v2: added `status` and `idempotency_key` fields.
 *            Old records without `status` are treated as 'pending' at read time.
 */

const DB_NAME    = 'fincaos-offline';
const DB_VERSION = 2;
const STORE      = 'pending-actions';
const MAX_INTENTOS = 4;

export type TipoAccionOffline =
  | 'crear_incidencia'
  | 'enviar_comentario'
  | 'marcar_afectado';

export type AccionStatus = 'pending' | 'syncing' | 'failed';

export interface AccionPendiente {
  id:               string;
  idempotency_key:  string; // Stable UUID — used for idempotent Firestore writes
  timestamp:        number;
  tipo:             TipoAccionOffline;
  payload:          Record<string, unknown>;
  intentos:         number;
  status:           AccionStatus;
  error?:           string;
}

/* ── IndexedDB helpers ──────────────────────────────────────────────────── */

async function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db         = req.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
      // v1→v2: no schema change in IDB; status/idempotency_key added in JS layer
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function encolarAccion(
  accion: Omit<AccionPendiente, 'id' | 'idempotency_key' | 'timestamp' | 'intentos' | 'status'>,
): Promise<void> {
  const db  = await abrirDB();
  const key = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({
      ...accion,
      id:              key,
      idempotency_key: key, // same as id — stable across retries
      timestamp:       Date.now(),
      intentos:        0,
      status:          'pending' as AccionStatus,
    } satisfies AccionPendiente);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function obtenerPendientes(): Promise<AccionPendiente[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      // Back-compat: old records without `status` treated as 'pending'
      const rows = (req.result as AccionPendiente[]).map((r) => ({
        ...r,
        status:          r.status          ?? 'pending',
        idempotency_key: r.idempotency_key ?? r.id,
      }));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
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

async function actualizarAccion(
  id: string,
  patch: Partial<Pick<AccionPendiente, 'status' | 'intentos' | 'error'>>,
): Promise<void> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get   = store.get(id);

    get.onsuccess = () => {
      if (!get.result) { resolve(); return; }
      store.put({ ...get.result, ...patch });
    };

    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/* ── Sync engine ─────────────────────────────────────────────────────────  */

export async function procesarCola(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const todas = await obtenerPendientes();

  // Only process: pending items, or failed items that haven't hit the retry ceiling
  const elegibles = todas.filter(
    (a) => a.status === 'pending' ||
           (a.status === 'failed' && a.intentos < MAX_INTENTOS),
  );

  for (const accion of elegibles) {
    // Mark as syncing — concurrent calls to procesarCola will skip this item
    await actualizarAccion(accion.id, { status: 'syncing' });

    try {
      await ejecutarAccion(accion);
      await eliminarAccion(accion.id); // success → clean up
    } catch (err) {
      const error       = err instanceof Error ? err.message : String(err);
      const nuevoIntentos = accion.intentos + 1;
      const nuevoStatus: AccionStatus =
        nuevoIntentos >= MAX_INTENTOS ? 'failed' : 'pending';

      await actualizarAccion(accion.id, {
        status:   nuevoStatus,
        intentos: nuevoIntentos,
        error,
      });
      console.warn('[OfflineQueue] Fallo al sincronizar acción', accion.id, ':', error);
    }
  }
}

/* ── Action executor ─────────────────────────────────────────────────────
   All writes are IDEMPOTENT:
     - marcar_afectado: server-side transaction checks existence
     - enviar_comentario: setDoc with idempotency_key as doc ID
     - crear_incidencia: setDoc with idempotency_key as doc ID
── */

async function ejecutarAccion(accion: AccionPendiente): Promise<void> {
  const { getAuth } = await import('firebase/auth');
  const currentUser = getAuth().currentUser;
  if (!currentUser) throw new Error('No hay usuario autenticado');

  const token = await currentUser.getIdToken();

  switch (accion.tipo) {

    case 'marcar_afectado': {
      // Server validates and deduplicates inside a Firestore transaction
      const res = await fetch('/api/incidencias/afectar', {
        method:  'POST',
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   `Bearer ${token}`,
          'Idempotency-Key': accion.idempotency_key,
        },
        body: JSON.stringify(accion.payload),
      });
      if (!res.ok) throw new Error(`marcar_afectado HTTP ${res.status}`);
      break;
    }

    case 'enviar_comentario': {
      // Use idempotency_key as doc ID → writing twice = same doc, no duplicate
      const { getFirestore, doc, setDoc } = await import('firebase/firestore');
      await setDoc(
        doc(getFirestore(), 'comentarios', accion.idempotency_key),
        {
          ...accion.payload,
          created_at:         accion.payload.created_at ?? new Date().toISOString(),
          _synced_from_queue: true,
        },
      );
      break;
    }

    case 'crear_incidencia': {
      // Use idempotency_key as doc ID → re-syncing the same offline incidencia
      // writes to the exact same document — no duplicate created
      const { getFirestore, doc, setDoc } = await import('firebase/firestore');
      await setDoc(
        doc(getFirestore(), 'incidencias', accion.idempotency_key),
        {
          ...accion.payload,
          created_at:         accion.payload.created_at ?? new Date().toISOString(),
          _synced_from_queue: true,
        },
      );
      break;
    }

    default:
      console.warn('[OfflineQueue] Tipo desconocido:', (accion as any).tipo);
  }
}

/* ── Auto-process on reconnect (browser only) ───────────────────────────── */
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void procesarCola(); });
}

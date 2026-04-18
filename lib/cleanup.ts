/**
 * lib/cleanup.ts
 *
 * Reutilizable: elimina documentos de una colección Firestore que cumplan
 * una condición WHERE, procesando en batches de 500 (límite Firestore).
 *
 * Diseño:
 *  - Un solo query paginado por ejecución → sin loops infinitos.
 *  - Idempotente: re-ejecutar es seguro (sólo borra lo que ya caduca).
 *  - Devuelve conteo + duración para logging externo.
 */

import { getAdminDb } from '@/lib/firebase/admin';
import type { Timestamp } from 'firebase-admin/firestore';

/** Operadores WHERE soportados (suficientes para cleanup). */
export type CleanupOperator = '<' | '<=' | '==' | '!=' | '>=' | '>';

export interface CleanupOptions {
  /** Colección de nivel raíz: '_rate_limits', 'notificaciones', etc. */
  collectionPath: string;
  /** Campo Firestore a evaluar. */
  field: string;
  /** Operador de comparación. */
  operator: CleanupOperator;
  /** Valor umbral — string ISO, Timestamp de Admin SDK, o número. */
  value: string | Timestamp | number;
  /**
   * Máximo de documentos a eliminar en esta llamada.
   * Impide timeouts y consumo de memoria descontrolado.
   * Default: 500.
   */
  maxDocs?: number;
}

export interface CleanupResult {
  deleted:    number;
  durationMs: number;
}

const BATCH_SIZE = 500; // límite duro de Firestore por batch

/**
 * Ejecuta la consulta, paginada en batches de 500 escrituras.
 * Nunca procesa más de `maxDocs` documentos por llamada.
 */
export async function cleanupCollection(opts: CleanupOptions): Promise<CleanupResult> {
  const { collectionPath, field, operator, value, maxDocs = 500 } = opts;

  // maxDocs nunca supera BATCH_SIZE × 2 para mantener el tiempo de ejecución acotado
  const safeMax = Math.min(maxDocs, BATCH_SIZE * 2);

  const db    = getAdminDb();
  const start = Date.now();

  const snap = await db
    .collection(collectionPath)
    .where(field, operator, value)
    .limit(safeMax)
    .get();

  if (snap.empty) {
    return { deleted: 0, durationMs: Date.now() - start };
  }

  let deleted = 0;

  // Procesar en chunks de BATCH_SIZE (500 ops/batch es el máximo de Firestore)
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const chunk = snap.docs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += chunk.length;
  }

  return { deleted, durationMs: Date.now() - start };
}

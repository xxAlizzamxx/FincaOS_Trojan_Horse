/**
 * lib/analytics.ts
 *
 * Registro de eventos de uso del producto — lado cliente.
 *
 * Principios de privacidad:
 *  ✗ Nunca almacenar email, nombre, teléfono ni ningún otro dato personal.
 *  ✗ Nunca almacenar contenido (títulos de incidencias, mensajes…).
 *  ✓ Solo acciones + IDs opacos de Firestore + contadores simples.
 *
 * Destino: colección `analytics_events` en Firestore.
 * Regla de Firestore: create si user_id == uid; read solo el propio usuario.
 *
 * Si falla (red, permisos), falla en silencio — jamás interrumpe el flujo del usuario.
 */

import { collection, addDoc } from 'firebase/firestore';
import { db } from './firebase/client';
import type { AnalyticsEventName } from '@/types/database';

/**
 * Registra un evento de uso.
 *
 * @param event        Nombre del evento (ver AnalyticsEventName)
 * @param userId       UID del usuario
 * @param comunidadId  ID de la comunidad, o null si no pertenece a ninguna
 * @param metadata     Metadatos no sensibles: IDs opacos, booleanos, contadores
 */
export async function trackEvent(
  event:       AnalyticsEventName,
  userId:      string,
  comunidadId: string | null,
  metadata:    Record<string, string | number | boolean> = {},
): Promise<void> {
  // Silently no-op if userId is empty (unauthenticated call guard)
  if (!userId) return;

  try {
    await addDoc(collection(db, 'analytics_events'), {
      user_id:      userId,
      comunidad_id: comunidadId ?? null,
      event,
      created_at:   new Date().toISOString(),
      metadata,
    });
  } catch {
    // Never break user experience for analytics failures.
    // Errors here are intentionally swallowed.
  }
}

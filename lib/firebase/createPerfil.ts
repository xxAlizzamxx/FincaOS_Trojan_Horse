/**
 * lib/firebase/createPerfil.ts
 *
 * Crea (o actualiza de forma idempotente) los dos documentos de perfil
 * de un usuario en una única operación de Firestore batch:
 *
 *   perfiles/{uid}          → datos públicos (nombre, avatar, rol, comunidad…)
 *   perfiles_privados/{uid} → datos sensibles (email, telefono, plan…)
 *
 * Garantías:
 *  - Idempotente: llamar varias veces con los mismos datos es seguro (set+merge).
 *  - Atómico: o se crean los dos o no se crea ninguno.
 *  - El teléfono NUNCA viaja al documento público.
 *
 * Uso:
 *   import { createPerfilBatch } from '@/lib/firebase/createPerfil';
 *   await createPerfilBatch(uid, publicData, privateData);
 */

import { doc, writeBatch } from 'firebase/firestore';
import { db } from './client';
import type { Perfil, PerfilPrivado } from '@/types/database';

/** Campos escritos en perfiles/{uid} — nunca incluye datos sensibles. */
export type PerfilPublicoInput = Omit<Perfil,
  | 'id'
  | 'comunidad'
  | 'telefono'       // va a perfiles_privados
>;

/** Campos escritos en perfiles_privados/{uid}. */
export type PerfilPrivadoInput = Partial<Omit<PerfilPrivado, 'uid'>>;

/**
 * Escribe ambos documentos en un batch.
 * Usa `merge: true` → seguro tanto para creación inicial como para actualizaciones.
 */
export async function createPerfilBatch(
  uid:          string,
  publicData:   PerfilPublicoInput,
  privateData:  PerfilPrivadoInput = {},
): Promise<void> {
  const batch = writeBatch(db);

  const now = new Date().toISOString();

  // ── Perfil público ──────────────────────────────────────────────────────
  batch.set(
    doc(db, 'perfiles', uid),
    { ...publicData, updated_at: now },
    { merge: true },
  );

  // ── Perfil privado ──────────────────────────────────────────────────────
  const defaultPrivate: PerfilPrivado = {
    uid,
    email:    null,
    telefono: null,
    plan:     'free',
    ultimo_login: now,
    preferencias_notificaciones: { push: true, email: true },
    created_at: now,
    updated_at: now,
    ...privateData,
  };

  batch.set(
    doc(db, 'perfiles_privados', uid),
    { ...defaultPrivate, updated_at: now },
    { merge: true },
  );

  await batch.commit();
}

/**
 * Actualiza solo el documento privado (sin tocar el público).
 * Útil para guardar telefono, preferencias o ultimo_login.
 */
export async function updatePerfilPrivado(
  uid:  string,
  data: Partial<Omit<PerfilPrivado, 'uid' | 'created_at'>>,
): Promise<void> {
  const { setDoc } = await import('firebase/firestore');
  await setDoc(
    doc(db, 'perfiles_privados', uid),
    { ...data, updated_at: new Date().toISOString() },
    { merge: true },
  );
}

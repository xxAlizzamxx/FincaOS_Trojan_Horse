import { collection, addDoc, query, where, getDocs, limit, orderBy } from 'firebase/firestore';
import { db } from './client';
import type { TipoNotificacion } from '@/types/database';

interface NotificationData {
  usuario_id: string;
  comunidad_id: string;
  tipo: 'incidencia' | 'estado' | 'comentario' | 'anuncio' | 'mediacion' | 'votacion';
  titulo: string;
  mensaje: string;
  link?: string;
}

export async function crearNotificacion(data: NotificationData) {
  await addDoc(collection(db, 'notificaciones'), {
    ...data,
    leida: false,
    created_at: new Date().toISOString(),
  });
}

export async function notificarAdmins(comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string) {
  // limit(20): una comunidad nunca tendrá más de 20 presidentes/admins simultáneos
  const adminsSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), where('rol', 'in', ['admin', 'presidente']), limit(20))
  );
  const promises = adminsSnap.docs.map((d) =>
    crearNotificacion({ usuario_id: d.id, comunidad_id: comunidadId, tipo, titulo, mensaje, link })
  );
  await Promise.all(promises);
}

export async function notificarComunidad(comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string, exceptUserId?: string) {
  // limit(500): techo razonable para una comunidad de propietarios.
  // Para comunidades más grandes migrar a crearNotificacionComunidad() (1 doc por evento).
  const vecinosSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), limit(500))
  );
  const promises = vecinosSnap.docs
    .filter((d) => d.id !== exceptUserId)
    .map((d) =>
      crearNotificacion({ usuario_id: d.id, comunidad_id: comunidadId, tipo, titulo, mensaje, link })
    );
  await Promise.all(promises);
}

export async function notificarUsuario(userId: string, comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string) {
  await crearNotificacion({ usuario_id: userId, comunidad_id: comunidadId, tipo, titulo, mensaje, link });
}

/* ─────────────────────────────────────────────────────────────────────────────
   NUEVO MODELO — Notificaciones de comunidad (1 doc por evento, no por usuario)
   Colección: comunidades/{comunidadId}/notificaciones/{auto-id}
   "No leída" se determina en cliente comparando created_at con
   perfil.notificaciones_last_read. No hay campo "leida" por documento.
───────────────────────────────────────────────────────────────────────────── */

interface NotificacionComunidadData {
  tipo:       TipoNotificacion;
  titulo:     string;
  mensaje:    string;
  created_by: string;   // uid del autor (se excluye del badge de no leídas)
  related_id: string;   // id del objeto original
  link:       string;   // ruta de navegación
}

/**
 * Crea UNA notificación en la subcolección de la comunidad.
 * Todos los miembros la ven — la lectura se controla por timestamp en perfil.
 * Es fire-and-forget: llámala sin await para no bloquear la acción del usuario.
 */
export async function crearNotificacionComunidad(
  comunidadId: string,
  data: NotificacionComunidadData,
): Promise<void> {
  await addDoc(
    collection(db, 'comunidades', comunidadId, 'notificaciones'),
    { ...data, created_at: new Date().toISOString() },
  );
}

/** Notifica a todos los mediadores de la comunidad sobre una nueva solicitud */
export async function notificarMediadores(
  comunidadId: string,
  mediacionId: string,
  descripcion = 'Un vecino solicitó mediación profesional',
) {
  // limit(20): número máximo razonable de mediadores en una comunidad
  const snap = await getDocs(
    query(
      collection(db, 'perfiles'),
      where('comunidad_id', '==', comunidadId),
      where('rol', '==', 'mediador'),
      limit(20),
    ),
  );
  const promises = snap.docs.map((d) =>
    crearNotificacion({
      usuario_id:   d.id,
      comunidad_id: comunidadId,
      tipo:         'mediacion',
      titulo:       'Nueva mediación disponible',
      mensaje:      descripcion,
      link:         `/mediaciones/${mediacionId}`,
    }),
  );
  await Promise.all(promises);
}

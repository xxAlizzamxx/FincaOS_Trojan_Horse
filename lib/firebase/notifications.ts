import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from './client';

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
  const adminsSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId), where('rol', 'in', ['admin', 'presidente']))
  );
  const promises = adminsSnap.docs.map((d) =>
    crearNotificacion({ usuario_id: d.id, comunidad_id: comunidadId, tipo, titulo, mensaje, link })
  );
  await Promise.all(promises);
}

export async function notificarComunidad(comunidadId: string, tipo: NotificationData['tipo'], titulo: string, mensaje: string, link?: string, exceptUserId?: string) {
  const vecinosSnap = await getDocs(
    query(collection(db, 'perfiles'), where('comunidad_id', '==', comunidadId))
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

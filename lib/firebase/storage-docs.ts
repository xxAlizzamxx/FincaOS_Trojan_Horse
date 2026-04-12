import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { storage } from './client';
import type { TipoDocumento } from '@/types/database';

/* ─── Tipos MIME aceptados ─── */
export const MIME_TIPOS: Record<string, TipoDocumento> = {
  'application/pdf':                                                        'pdf',
  'application/msword':                                                     'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'word',
  'application/vnd.ms-excel':                                               'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':      'excel',
};

export const EXTENSIONES_ACEPTADAS = '.pdf,.doc,.docx,.xls,.xlsx';

export function inferirTipo(file: File): TipoDocumento | null {
  return MIME_TIPOS[file.type] ?? null;
}

export interface UploadResult {
  url: string;
  storagePath: string;
  tipo: TipoDocumento;
}

/**
 * Sube un fichero a docs/{comunidadId}/{ts}_{nombre}
 * Devuelve url de descarga, path de storage y tipo inferido.
 * Lanza Error si el MIME no está permitido.
 */
export async function subirDocumento(
  file: File,
  comunidadId: string,
  onProgress?: (pct: number) => void
): Promise<UploadResult> {
  const tipo = inferirTipo(file);
  if (!tipo) throw new Error('Formato no permitido. Usa PDF, Word o Excel.');

  const ts = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `docs/${comunidadId}/${ts}_${safeName}`;

  const storageRef = ref(storage, storagePath);
  const uploadTask = uploadBytesResumable(storageRef, file, {
    contentType: file.type,
  });

  return new Promise((resolve, reject) => {
    uploadTask.on(
      'state_changed',
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress?.(pct);
      },
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        resolve({ url, storagePath, tipo });
      }
    );
  });
}

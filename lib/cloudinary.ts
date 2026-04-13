/**
 * Cloudinary — configuración y helpers SERVER-SIDE únicamente.
 * Nunca importar desde componentes cliente ('use client').
 * Las credenciales CLOUDINARY_API_SECRET jamás llegan al bundle del navegador.
 *
 * ⚠️  NO usar base64 / data URIs: inflan el payload un 33 % y provocan 413 en
 *     la API de Cloudinary para archivos medianos/grandes.
 *     Usamos upload_stream + Readable.from(buffer) para enviar binario puro.
 *     Readable.from() opera en memoria → 100 % compatible con Vercel serverless.
 */
import { v2 as cloudinary } from 'cloudinary';
import { Readable }         from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

export interface CloudinaryUploadResult {
  url:       string;  // URL HTTPS permanente
  public_id: string;  // ID para gestionar el asset en Cloudinary
}

/* ─── Helper interno ────────────────────────────────────────────────────────
 * Envuelve cloudinary.uploader.upload_stream en una Promise.
 * Usa Readable.from(buffer) para crear un stream Node.js desde un Buffer
 * en memoria y lo pipea al writable stream de Cloudinary.
 * ─────────────────────────────────────────────────────────────────────────── */
function uploadStreamPromise(
  buffer: Buffer,
  options: Parameters<typeof cloudinary.uploader.upload_stream>[0],
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options ?? {},
      (error, result) => {
        if (error)   return reject(error);
        if (!result) return reject(new Error('Cloudinary no devolvió resultado'));
        resolve({ url: result.secure_url, public_id: result.public_id });
      },
    );

    // Readable.from(buffer) crea un stream de lectura completamente en memoria.
    // No requiere acceso al sistema de ficheros → seguro en Vercel serverless.
    Readable.from(buffer).pipe(uploadStream);
  });
}

/* ─── uploadImage ────────────────────────────────────────────────────────────
 * Sube una imagen a Cloudinary con optimización automática.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function uploadImage(
  buffer:   Buffer,
  folder:   string,
  filename: string,
  _mimeType = 'image/jpeg',   // no se usa: Cloudinary detecta el formato
): Promise<CloudinaryUploadResult> {
  console.log('[Cloudinary] uploadImage →', { folder, filename, bytes: buffer.length });

  const result = await uploadStreamPromise(buffer, {
    folder,
    public_id:       filename,
    resource_type:   'image',
    overwrite:       false,
    unique_filename: true,
    transformation:  [{ quality: 'auto', fetch_format: 'auto', width: 1600, crop: 'limit' }],
  });

  console.log('[Cloudinary] uploadImage OK →', result.url);
  return result;
}

/* ─── uploadBuffer ───────────────────────────────────────────────────────────
 * Sube un archivo binario (PDF, Word, Excel…) a Cloudinary.
 * resource_type "raw" es OBLIGATORIO para documentos no-imagen.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function uploadBuffer(
  buffer:   Buffer,
  folder:   string,
  filename: string,
  _mimeType = 'application/octet-stream',   // no se usa: Cloudinary lo infiere
): Promise<CloudinaryUploadResult> {
  console.log('[Cloudinary] uploadBuffer →', { folder, filename, bytes: buffer.length });

  const result = await uploadStreamPromise(buffer, {
    folder,
    public_id:       filename,
    resource_type:   'raw',
    overwrite:       false,
    unique_filename: true,
  });

  console.log('[Cloudinary] uploadBuffer OK →', result.url);
  return result;
}

export default cloudinary;

/**
 * Cloudinary — configuración y helpers SERVER-SIDE únicamente.
 * Nunca importar desde componentes cliente ('use client').
 * Las credenciales CLOUDINARY_API_SECRET jamás llegan al bundle del navegador.
 *
 * Se usa upload_stream + Readable.from(buffer) para enviar binario puro,
 * evitando la inflación del 33 % que produce la codificación base64 y que
 * provocaba errores 413 en la API de Cloudinary para archivos medianos/grandes.
 * Readable.from() opera completamente en memoria → compatible con Vercel serverless.
 */
import { v2 as cloudinary } from 'cloudinary';
import { Readable }          from 'stream';

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

/**
 * Opciones aceptadas por upload_stream.
 * Se definen aquí para no depender de tipos internos de cloudinary v2
 * que cambian entre versiones (evita errores de compilación en Next.js 13).
 */
interface UploadStreamOptions {
  folder?:          string;
  public_id?:       string;
  resource_type?:   'image' | 'video' | 'raw' | 'auto';
  overwrite?:       boolean;
  unique_filename?: boolean;
  transformation?:  Array<Record<string, unknown>>;
  [key: string]:    unknown;   // permite pasar cualquier opción adicional
}

/* ─── Helper interno ────────────────────────────────────────────────────────
 * Envuelve cloudinary.uploader.upload_stream en una Promise.
 * Convierte el Buffer a un Readable Node.js en memoria y lo pipea
 * al writable stream de Cloudinary (sin acceso a disco → serverless OK).
 * ─────────────────────────────────────────────────────────────────────────── */
function uploadStreamPromise(
  buffer:  Buffer,
  options: UploadStreamOptions,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error)   return reject(error);
        if (!result) return reject(new Error('Cloudinary no devolvió resultado'));
        resolve({ url: result.secure_url, public_id: result.public_id });
      },
    );

    // Readable.from(buffer) crea un stream de lectura completamente en memoria.
    // No requiere sistema de ficheros → seguro en entornos serverless (Vercel).
    Readable.from(buffer).pipe(uploadStream);
  });
}

/* ─── uploadImage ────────────────────────────────────────────────────────────
 * Sube una imagen a Cloudinary con optimización automática vía streaming.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function uploadImage(
  buffer:    Buffer,
  folder:    string,
  filename:  string,
  _mimeType = 'image/jpeg',   // Cloudinary detecta el formato automáticamente
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
 * Sube un archivo binario (PDF, Word, Excel…) a Cloudinary vía streaming.
 * resource_type "raw" es OBLIGATORIO para documentos no-imagen.
 * ─────────────────────────────────────────────────────────────────────────── */
export async function uploadBuffer(
  buffer:    Buffer,
  folder:    string,
  filename:  string,
  _mimeType = 'application/octet-stream',   // Cloudinary lo infiere del contenido
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

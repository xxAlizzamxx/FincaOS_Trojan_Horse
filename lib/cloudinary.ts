/**
 * Cloudinary — configuración y helpers SERVER-SIDE únicamente.
 * Nunca importar desde componentes cliente ('use client').
 * Las credenciales CLOUDINARY_API_SECRET jamás llegan al bundle del navegador.
 */
import { v2 as cloudinary } from 'cloudinary';

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
 * Sube un Buffer a Cloudinary usando base64 (compatible con Vercel serverless).
 * resource_type "raw" es OBLIGATORIO para PDFs, Word y Excel.
 */
export async function uploadBuffer(
  buffer: Buffer,
  folder: string,
  filename: string,
  mimeType = 'application/octet-stream',
): Promise<CloudinaryUploadResult> {
  const b64 = buffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${b64}`;

  console.log('[Cloudinary] uploadBuffer →', { folder, filename, bytes: buffer.length });

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    public_id:       filename,
    resource_type:   'raw',
    overwrite:       false,
    unique_filename: true,
  });

  console.log('[Cloudinary] uploadBuffer OK →', result.secure_url);

  return {
    url:       result.secure_url,
    public_id: result.public_id,
  };
}

/**
 * Sube una imagen a Cloudinary con optimización automática.
 * Usa base64 para máxima compatibilidad con Vercel serverless.
 */
export async function uploadImage(
  buffer: Buffer,
  folder: string,
  filename: string,
  mimeType = 'image/jpeg',
): Promise<CloudinaryUploadResult> {
  const b64 = buffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${b64}`;

  console.log('[Cloudinary] uploadImage →', { folder, filename, bytes: buffer.length });

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    public_id:       filename,
    resource_type:   'image',
    overwrite:       false,
    unique_filename: true,
    transformation:  [{ quality: 'auto', fetch_format: 'auto', width: 1600, crop: 'limit' }],
  });

  console.log('[Cloudinary] uploadImage OK →', result.secure_url);

  return {
    url:       result.secure_url,
    public_id: result.public_id,
  };
}

export default cloudinary;

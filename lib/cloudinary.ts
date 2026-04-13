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
  url:        string;   // URL HTTPS permanente
  public_id:  string;   // ID para gestionar el asset en Cloudinary
}

/**
 * Sube un Buffer a Cloudinary.
 *
 * @param buffer   - Contenido del archivo en Buffer
 * @param folder   - Carpeta destino en Cloudinary (ej: "fincaos/docs")
 * @param filename - Nombre base del archivo (se usa como public_id)
 *
 * NOTA: resource_type "raw" es OBLIGATORIO para PDF, Word y Excel.
 * Sin él, Cloudinary intenta procesar el archivo como imagen y falla.
 */
export async function uploadBuffer(
  buffer: Buffer,
  folder: string,
  filename: string,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id:     filename,
        resource_type: 'raw',      // ← CRÍTICO para no-imágenes
        overwrite:     false,
        unique_filename: true,
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary: resultado vacío'));
          return;
        }
        resolve({
          url:       result.secure_url,
          public_id: result.public_id,
        });
      },
    );

    uploadStream.end(buffer);
  });
}

/**
 * Sube una imagen a Cloudinary con transformaciones automáticas.
 */
export async function uploadImage(
  buffer: Buffer,
  folder: string,
  filename: string,
): Promise<CloudinaryUploadResult> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id:       filename,
        resource_type:   'image',
        overwrite:       false,
        unique_filename: true,
        transformation:  [{ quality: 'auto', fetch_format: 'auto', width: 1600, crop: 'limit' }],
      },
      (error, result) => {
        if (error || !result) {
          reject(error ?? new Error('Cloudinary: resultado vacío'));
          return;
        }
        resolve({
          url:       result.secure_url,
          public_id: result.public_id,
        });
      },
    );

    uploadStream.end(buffer);
  });
}

export default cloudinary;

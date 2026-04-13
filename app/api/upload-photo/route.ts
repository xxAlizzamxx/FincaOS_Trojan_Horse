/**
 * POST /api/upload-photo
 *
 * Recibe un FormData con:
 *   - file         : File  (imagen)
 *   - comunidad_id : string (opcional)
 *   - incidencia_id: string (opcional)
 *
 * Sube la imagen a Cloudinary via upload_stream (binario puro, sin base64).
 * Devuelve: { url, public_id }
 */
import { NextRequest, NextResponse } from 'next/server';
import { uploadImage }               from '@/lib/cloudinary';

// Necesario en Vercel para evitar timeout en uploads grandes
export const maxDuration = 60;
// Forzar runtime Node.js (stream.Readable disponible)
export const runtime = 'nodejs';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest) {
  try {
    // ── Credenciales ────────────────────────────────────────────────────────
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY    ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      console.error('[upload-photo] Faltan variables de entorno de Cloudinary');
      return NextResponse.json(
        { error: 'Configuración de almacenamiento incompleta' },
        { status: 500 },
      );
    }

    // ── Parsear FormData ─────────────────────────────────────────────────────
    const formData     = await req.formData();
    const file         = formData.get('file') as File | null;
    const comunidadId  = (formData.get('comunidad_id')  as string | null) ?? 'general';
    const incidenciaId =  formData.get('incidencia_id') as string | null;

    console.log(
      '[upload-photo] file:', file?.name,
      '| type:', file?.type,
      '| size:', file?.size,
    );

    // ── Validaciones ─────────────────────────────────────────────────────────
    if (!file) {
      return NextResponse.json(
        { error: 'No se envió ningún archivo' },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Formato no permitido: ${file.type}. Usa JPG, PNG o WebP.` },
        { status: 415 },
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        {
          error: `La imagen supera el límite de 10 MB ` +
                 `(${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        },
        { status: 413 },
      );
    }

    // ── Subida a Cloudinary ──────────────────────────────────────────────────
    // file.arrayBuffer() obtiene el binario puro; nunca lo convertimos a base64.
    // uploadImage internamente usa upload_stream + Readable.from(buffer).
    const buffer    = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName  = file.name
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/\.[^.]+$/, '');
    const folder    = `fincaos/fotos/${comunidadId}`;
    const filename  = incidenciaId
      ? `${incidenciaId}_${timestamp}_${safeName}`
      : `${timestamp}_${safeName}`;

    const { url, public_id } = await uploadImage(buffer, folder, filename, file.type);

    console.log('[upload-photo] OK →', url);
    return NextResponse.json({ url, public_id });

  } catch (error: any) {
    console.error('[upload-photo] Error:', error?.message ?? error);
    return NextResponse.json(
      { error: error?.message ?? 'Error al subir la imagen' },
      { status: 500 },
    );
  }
}

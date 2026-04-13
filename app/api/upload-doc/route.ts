/**
 * POST /api/upload-doc
 *
 * Recibe un FormData con:
 *   - file         : File   (PDF, Word, Excel)
 *   - comunidad_id : string (opcional)
 *
 * Sube el documento a Cloudinary via upload_stream (binario puro, sin base64).
 * Devuelve: { url, public_id, tipo }
 */
import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer }              from '@/lib/cloudinary';

// Necesario en Vercel para evitar timeout en uploads grandes
export const maxDuration = 60;
// Forzar runtime Node.js (stream.Readable disponible)
export const runtime = 'nodejs';

const MIME_TIPOS: Record<string, 'pdf' | 'word' | 'excel'> = {
  'application/pdf':                                                          'pdf',
  'application/msword':                                                       'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'application/vnd.ms-excel':                                                 'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':        'excel',
};

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  try {
    // ── Credenciales ────────────────────────────────────────────────────────
    if (
      !process.env.CLOUDINARY_CLOUD_NAME ||
      !process.env.CLOUDINARY_API_KEY    ||
      !process.env.CLOUDINARY_API_SECRET
    ) {
      console.error('[upload-doc] Faltan variables de entorno de Cloudinary');
      return NextResponse.json(
        { error: 'Configuración de almacenamiento incompleta' },
        { status: 500 },
      );
    }

    // ── Parsear FormData ─────────────────────────────────────────────────────
    const formData    = await req.formData();
    const file        = formData.get('file') as File | null;
    const comunidadId = (formData.get('comunidad_id') as string | null) ?? 'sin-comunidad';

    console.log(
      '[upload-doc] file:', file?.name,
      '| type:', file?.type,
      '| size:', file?.size,
    );

    // ── Validaciones ─────────────────────────────────────────────────────────
    if (!file) {
      return NextResponse.json(
        { error: 'No se recibió ningún archivo.' },
        { status: 400 },
      );
    }

    const tipo = MIME_TIPOS[file.type];
    if (!tipo) {
      return NextResponse.json(
        { error: `Formato no permitido: ${file.type}. Usa PDF, Word o Excel.` },
        { status: 415 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          error: `El archivo supera el límite de 20 MB ` +
                 `(${(file.size / 1024 / 1024).toFixed(1)} MB).`,
        },
        { status: 413 },
      );
    }

    // ── Subida a Cloudinary ──────────────────────────────────────────────────
    // file.arrayBuffer() obtiene el binario puro; nunca lo convertimos a base64.
    // uploadBuffer internamente usa upload_stream + Readable.from(buffer).
    const buffer   = Buffer.from(await file.arrayBuffer());
    const ts       = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${ts}_${safeName}`;
    const folder   = `fincaos/docs/${comunidadId}`;

    const { url, public_id } = await uploadBuffer(buffer, folder, filename, file.type);

    console.log('[upload-doc] OK →', url);
    return NextResponse.json({ url, public_id, tipo });

  } catch (err: any) {
    console.error('[upload-doc] Error:', err?.message ?? err);
    return NextResponse.json(
      { error: err?.message ?? 'Error interno al subir el documento.' },
      { status: 500 },
    );
  }
}

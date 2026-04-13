import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer } from '@/lib/cloudinary';

const MIME_TIPOS: Record<string, 'pdf' | 'word' | 'excel'> = {
  'application/pdf':                                                           'pdf',
  'application/msword':                                                        'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':  'word',
  'application/vnd.ms-excel':                                                  'excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':         'excel',
};

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  try {
    // Validar que las credenciales de Cloudinary estén configuradas
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.error('[upload-doc] Faltan variables de entorno de Cloudinary');
      return NextResponse.json({ error: 'Configuración de almacenamiento incompleta' }, { status: 500 });
    }

    const formData    = await req.formData();
    const file        = formData.get('file') as File | null;
    const comunidadId = (formData.get('comunidad_id') as string | null) ?? 'sin-comunidad';

    console.log('[upload-doc] file:', file?.name, '| type:', file?.type, '| size:', file?.size);

    if (!file) {
      return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });
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
        { error: `El archivo supera el límite de 20 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).` },
        { status: 413 },
      );
    }

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

import { NextRequest, NextResponse } from 'next/server';
import { uploadBuffer } from '@/lib/cloudinary';

/* ── MIME → tipo semántico ── */
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
    /* 1. Extraer FormData */
    const formData = await req.formData();
    const file     = formData.get('file') as File | null;
    const comunidadId = (formData.get('comunidad_id') as string | null) ?? 'sin-comunidad';

    if (!file) {
      return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 });
    }

    /* 2. Validar MIME (segunda capa; la primera es frontend) */
    const tipo = MIME_TIPOS[file.type];
    if (!tipo) {
      return NextResponse.json(
        { error: `Formato no permitido: ${file.type}. Usa PDF, Word o Excel.` },
        { status: 415 },
      );
    }

    /* 3. Validar tamaño */
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `El archivo supera el límite de 20 MB (${(file.size / 1024 / 1024).toFixed(1)} MB).` },
        { status: 413 },
      );
    }

    /* 4. Convertir a Buffer */
    const arrayBuffer = await file.arrayBuffer();
    const buffer      = Buffer.from(arrayBuffer);

    /* 5. Subir a Cloudinary */
    const ts       = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${ts}_${safeName}`;
    const folder   = `fincaos/docs/${comunidadId}`;

    const { url, public_id } = await uploadBuffer(buffer, folder, filename);

    /* 6. Devolver resultado */
    return NextResponse.json({ url, public_id, tipo });

  } catch (err: any) {
    console.error('[upload-doc] Error:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Error interno al subir el documento.' },
      { status: 500 },
    );
  }
}

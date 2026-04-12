import { NextRequest, NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

/**
 * GET /api/open-doc?public_id=<cloudinaryPublicId>&nombre=<fileName>&tipo=<pdf|word|excel>
 *
 * Solución al error 401: Cloudinary protege los uploads "raw".
 * Este proxy usa el SDK server-side para generar una URL FIRMADA
 * con el API secret (nunca expuesto al cliente), la descarga y la
 * devuelve al navegador con los headers correctos.
 *
 * Al ser same-origin (/api/...) elimina además el error
 * "Unsafe attempt to load URL from chrome-error://chromewebdata/".
 */

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure:     true,
});

const CONTENT_TYPES: Record<string, string> = {
  pdf:   'application/pdf',
  word:  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const publicId = searchParams.get('public_id') ?? '';
  const nombre   = searchParams.get('nombre')    ?? 'documento';
  const tipo     = searchParams.get('tipo')      ?? 'pdf';

  /* ── Validación ── */
  if (!publicId) {
    return NextResponse.json({ error: 'Parámetro public_id requerido.' }, { status: 400 });
  }

  /* ── Generar URL firmada con el SDK (usa CLOUDINARY_API_SECRET) ── */
  // sign_url:true añade un token s--xxxx-- que Cloudinary acepta sin 401
  const signedUrl = cloudinary.url(publicId, {
    resource_type: 'raw',
    type:          'upload',
    sign_url:      true,
    secure:        true,
  });

  /* ── Fetch del fichero usando la URL firmada ── */
  let cloudRes: Response;
  try {
    cloudRes = await fetch(signedUrl, { cache: 'no-store' });
  } catch {
    return NextResponse.json({ error: 'No se pudo contactar con Cloudinary.' }, { status: 502 });
  }

  if (!cloudRes.ok) {
    return NextResponse.json(
      { error: `Cloudinary devolvió ${cloudRes.status}` },
      { status: cloudRes.status },
    );
  }

  /* ── Headers de respuesta ── */
  const contentType = CONTENT_TYPES[tipo] ?? 'application/octet-stream';

  // PDF → inline: el navegador lo renderiza en la propia pestaña
  // Word/Excel → attachment: descarga directa con el nombre del fichero
  const ext = tipo === 'pdf' ? '.pdf' : tipo === 'word' ? '.docx' : '.xlsx';
  const disposition =
    tipo === 'pdf'
      ? `inline; filename="${encodeURIComponent(nombre)}${ext}"`
      : `attachment; filename="${encodeURIComponent(nombre)}${ext}"`;

  const body = await cloudRes.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type':        contentType,
      'Content-Disposition': disposition,
      'Content-Length':      String(body.byteLength),
      'Cache-Control':       'private, max-age=3600',
    },
  });
}

/**
 * GET /api/test-email
 *
 * Endpoint temporal para verificar que SMTP está correctamente configurado.
 * Envía un email de prueba a los admins de una comunidad.
 *
 * Seguridad: requiere CRON_SECRET — nunca exponer sin autenticación.
 *
 * Uso:
 *   curl -H "Authorization: Bearer <CRON_SECRET>" \
 *        "https://tu-app.vercel.app/api/test-email?comunidad_id=<ID>"
 *
 * ELIMINAR o proteger adecuadamente antes de pasar a producción real.
 */

import { NextRequest, NextResponse } from 'next/server';
import { sendSmartAlert }            from '@/lib/email';
import { sendAdminNotification }     from '@/lib/email';
import { createLogger }              from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const log = createLogger({ route: '/api/test-email' });

  /* ── 1. Auth guard (mismo secret que el cron job) ─────────────────────── */
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en las variables de entorno' },
      { status: 500 },
    );
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${secret}`) {
    log.warn('test_email_unauthorized', {
      ip: req.headers.get('x-forwarded-for') ?? 'unknown',
    });
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  /* ── 2. Parámetros ────────────────────────────────────────────────────── */
  const comunidadId = req.nextUrl.searchParams.get('comunidad_id');
  if (!comunidadId) {
    return NextResponse.json(
      { ok: false, error: 'Falta el parámetro ?comunidad_id=<ID>' },
      { status: 400 },
    );
  }

  const tipo = (req.nextUrl.searchParams.get('tipo') ?? 'basic') as
    | 'basic'
    | 'quorum'
    | 'zone'
    | 'payments';

  /* ── 3. Enviar email de prueba ────────────────────────────────────────── */
  const t0 = Date.now();

  try {
    if (tipo === 'quorum') {
      await sendSmartAlert({
        type:        'quorum_reached',
        comunidad_id: comunidadId,
        metadata: { titulo: 'Incidencia de prueba', afectados: 5, porcentaje: 42 },
      });
    } else if (tipo === 'zone') {
      await sendSmartAlert({
        type:        'high_zone_activity',
        comunidad_id: comunidadId,
        metadata: { zona: 'Zona A (prueba)', count: 7 },
      });
    } else if (tipo === 'payments') {
      await sendSmartAlert({
        type:        'pending_payments',
        comunidad_id: comunidadId,
        metadata: { count: 3, importe_total: 450 },
      });
    } else {
      // basic — email directo
      await sendAdminNotification({
        comunidad_id: comunidadId,
        subject:      '✅ Test SMTP — FincaOS',
        content: [
          'Este es un email de prueba enviado desde el endpoint /api/test-email.',
          '',
          `🕒 Enviado a las: ${new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' })}`,
          `🏢 Comunidad ID: ${comunidadId}`,
          '',
          'Si recibes este mensaje, la configuración SMTP está funcionando correctamente.',
          '',
          '✔ SMTP_HOST conectado',
          '✔ Credenciales válidas',
          '✔ Email entregado',
        ].join('\n'),
      });
    }

    log.info('test_email_sent', { comunidad_id: comunidadId, tipo, duration_ms: Date.now() - t0 });

    return NextResponse.json({
      ok:          true,
      tipo,
      comunidad_id: comunidadId,
      duration_ms: Date.now() - t0,
      message:     'Email enviado (o ignorado por dedup si ya se envió en los últimos 30s)',
    });

  } catch (err: unknown) {
    log.error('test_email_failed', err, { comunidad_id: comunidadId, tipo });
    return NextResponse.json(
      {
        ok:    false,
        error: err instanceof Error ? err.message : 'Error desconocido',
        hint:  'Verifica SMTP_HOST, SMTP_USER, SMTP_PASS en las variables de entorno de Vercel',
      },
      { status: 500 },
    );
  }
}

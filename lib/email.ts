/**
 * Email service — notificaciones para administradores de comunidad.
 *
 * Env vars requeridas:
 *   SMTP_HOST, SMTP_PORT (def: 587), SMTP_USER, SMTP_PASS
 *
 * Características:
 *  - Retry: 1 reintento con 1 s de espera si falla el primer envío
 *  - Dedup: ignora si ya se envió el mismo (comunidad+subject) en los
 *    últimos DEDUP_TTL_MS ms (evita duplicados en hot-reload o retries externos)
 *  - Rate limit: máx RATE_MAX emails / minuto por comunidad (anti-spam)
 *  - Logging estructurado con timing exacto
 *  - Fire-and-forget real: nunca lanza ni bloquea el flujo de negocio
 *
 * NOTA: el estado in-memory persiste mientras el container serverless esté
 * caliente. Para dedup absoluto entre invocaciones usa Firestore o Redis.
 */

import nodemailer from 'nodemailer';
import { getAdminDb }    from '@/lib/firebase/admin';
import { createLogger }  from '@/lib/logger';

const log = createLogger({ route: 'lib/email' });

/* ── Constantes ──────────────────────────────────────────────────────────── */

const DEDUP_TTL_MS = 30_000;   // 30 s — ignora duplicados exactos
const RATE_MAX     = 3;         // máx 3 emails por comunidad…
const RATE_WIN_MS  = 60_000;   // …en una ventana de 60 s
const RETRY_DELAY  = 1_000;    // 1 s entre intento 1 y reintento

/* ── Estado in-memory ────────────────────────────────────────────────────── */

interface RateBucket { count: number; windowStart: number }

/** key: `${comunidad_id}:${subject}` → last send timestamp */
const dedupCache:     Map<string, number>     = new Map();
/** key: comunidad_id → rate bucket */
const rateBucketMap:  Map<string, RateBucket> = new Map();

/* ── Guards ──────────────────────────────────────────────────────────────── */

function checkDedup(comunidad_id: string, subject: string): boolean {
  const key  = `${comunidad_id}:${subject}`;
  const last = dedupCache.get(key);
  if (last && Date.now() - last < DEDUP_TTL_MS) return true; // duplicate
  dedupCache.set(key, Date.now());
  return false;
}

function checkRateLimit(comunidad_id: string): boolean {
  const now    = Date.now();
  const bucket = rateBucketMap.get(comunidad_id);

  if (!bucket || now - bucket.windowStart > RATE_WIN_MS) {
    // nueva ventana
    rateBucketMap.set(comunidad_id, { count: 1, windowStart: now });
    return false;
  }
  if (bucket.count >= RATE_MAX) return true; // rate-limited
  bucket.count++;
  return false;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createTransporter(): nodemailer.Transporter {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('SMTP no configurado: faltan SMTP_HOST, SMTP_USER o SMTP_PASS');
  }

  return nodemailer.createTransport({
    host,
    port,
    secure:            port === 465,
    auth:              { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout:   5_000,
  });
}

/** Envía con 1 reintento automático (delay 1 s entre intentos). */
async function sendWithRetry(
  transporter: nodemailer.Transporter,
  options: nodemailer.SendMailOptions,
): Promise<void> {
  try {
    await transporter.sendMail(options);
  } catch (firstErr) {
    log.warn('email_send_retry', { subject: options.subject, error: String(firstErr) });
    await delay(RETRY_DELAY);
    // Si el segundo intento también falla, lanza para que el caller lo capture
    await transporter.sendMail(options);
  }
}

/* ── API pública ─────────────────────────────────────────────────────────── */

/**
 * Envía un email a todos los admins/presidentes de una comunidad.
 *
 * @param comunidad_id  ID de la comunidad
 * @param subject       Asunto (sin el prefijo [FincaOS])
 * @param content       Cuerpo en texto plano — se convierte a HTML internamente
 *
 * @example
 * void sendAdminNotification({
 *   comunidad_id: 'abc123',
 *   subject: 'Nueva incidencia crítica',
 *   content: 'Fuga de agua en el sótano.',
 * });
 */
export async function sendAdminNotification({
  comunidad_id,
  subject,
  content,
}: {
  comunidad_id: string;
  subject:      string;
  content:      string;
}): Promise<void> {
  const t0 = Date.now();

  // ── 1. Dedup ─────────────────────────────────────────────────────────────
  if (checkDedup(comunidad_id, subject)) {
    log.info('email_dedup_skipped', { comunidad_id, subject });
    return;
  }

  // ── 2. Rate limit ─────────────────────────────────────────────────────────
  if (checkRateLimit(comunidad_id)) {
    log.warn('email_rate_limited', { comunidad_id, subject, max: RATE_MAX, window_ms: RATE_WIN_MS });
    return;
  }

  try {
    const db = getAdminDb();

    // ── 3. Obtener admins/presidentes ────────────────────────────────────────
    const adminSnap = await db
      .collection('perfiles')
      .where('comunidad_id', '==', comunidad_id)
      .where('rol', 'in', ['admin', 'presidente'])
      .limit(20)
      .get();

    if (adminSnap.empty) {
      log.info('email_no_admins', { comunidad_id });
      return;
    }

    // ── 4. Emails en perfiles_privados (no en el perfil público) ─────────────
    const privSnaps = await Promise.all(
      adminSnap.docs.map((d) => db.collection('perfiles_privados').doc(d.id).get()),
    );

    const emails = privSnaps
      .map((s) => s.data()?.email as string | undefined)
      .filter((e): e is string => typeof e === 'string' && e.includes('@'));

    if (emails.length === 0) {
      log.info('email_no_addresses', { comunidad_id });
      return;
    }

    // ── 5. Enviar con retry ───────────────────────────────────────────────────
    const transporter = createTransporter();
    await sendWithRetry(transporter, {
      from:    `FincaOS <${process.env.SMTP_USER}>`,
      to:      emails.join(', '),
      subject: `[FincaOS] ${subject}`,
      html:    buildHtml(subject, content),
      text:    `${subject}\n\n${content}`,
    });

    log.info('email_sent', {
      comunidad_id,
      subject,
      recipients:  emails.length,
      duration_ms: Date.now() - t0,
    });

  } catch (err) {
    // Nunca propagar — el email no debe romper el flujo principal
    log.error('email_failed', err, {
      comunidad_id,
      subject,
      duration_ms: Date.now() - t0,
    });
  }
}

/* ── Template HTML ───────────────────────────────────────────────────────── */

function buildHtml(subject: string, content: string): string {
  const safe = content
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:20px;background:#f4f4f5;
             font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"
         style="max-width:560px;margin:0 auto;">
    <tr><td>

      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#FF6E61;border-radius:16px 16px 0 0;padding:24px;">
        <tr>
          <td align="center">
            <span style="font-size:22px;font-weight:700;color:#fff;">🏢 FincaOS</span>
          </td>
        </tr>
      </table>

      <!-- Body -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#fff;padding:28px 24px;">
        <tr>
          <td>
            <h2 style="margin:0 0 16px;font-size:16px;color:#111827;">${subject}</h2>
            <div style="background:#f9fafb;border-radius:10px;padding:16px;
                        font-size:14px;line-height:1.7;color:#374151;">
              ${safe}
            </div>
          </td>
        </tr>
      </table>

      <!-- Footer -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#f9fafb;border-radius:0 0 16px 16px;
                    padding:16px 24px;border-top:1px solid #e5e7eb;">
        <tr>
          <td align="center"
              style="font-size:11px;color:#9ca3af;line-height:1.6;">
            Este email fue enviado automáticamente por FincaOS.<br>
            Por favor, no respondas a este mensaje.
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

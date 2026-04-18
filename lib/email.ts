/**
 * Email service — notificaciones para administradores de comunidad.
 *
 * Usa nodemailer con transporte SMTP configurable via env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *
 * Fire-and-forget: sendAdminNotification nunca lanza — los fallos
 * se loguean pero no rompen el flujo de negocio.
 *
 * Privacidad: los emails se obtienen de perfiles_privados (no del perfil público).
 */
import nodemailer from 'nodemailer';
import { getAdminDb } from '@/lib/firebase/admin';
import { createLogger } from '@/lib/logger';

const log = createLogger({ route: 'lib/email' });

/* ── Transporter ─────────────────────────────────────────────────────────── */

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
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
  });
}

/* ── API pública ─────────────────────────────────────────────────────────── */

/**
 * Envía un email a todos los admins/presidentes de una comunidad.
 *
 * @param comunidad_id  - ID de la comunidad
 * @param subject       - Asunto del email (sin el prefijo [FincaOS])
 * @param content       - Cuerpo en texto plano (se convierte a HTML internamente)
 *
 * @example
 * await sendAdminNotification({
 *   comunidad_id: 'abc123',
 *   subject: 'Nueva incidencia crítica',
 *   content: 'Se ha reportado una fuga de agua en el sótano.',
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
  try {
    const db = getAdminDb();

    // Obtener admins y presidentes de la comunidad
    const adminSnap = await db
      .collection('perfiles')
      .where('comunidad_id', '==', comunidad_id)
      .where('rol', 'in', ['admin', 'presidente'])
      .limit(20)
      .get();

    if (adminSnap.empty) {
      log.info('no_admins_found', { comunidad_id });
      return;
    }

    // Los emails están en perfiles_privados (privacidad)
    const privSnaps = await Promise.all(
      adminSnap.docs.map((d) => db.collection('perfiles_privados').doc(d.id).get()),
    );

    const emails = privSnaps
      .map((s) => s.data()?.email as string | undefined)
      .filter((e): e is string => typeof e === 'string' && e.includes('@'));

    if (emails.length === 0) {
      log.info('no_admin_emails_found', { comunidad_id });
      return;
    }

    const transporter = createTransporter();

    await transporter.sendMail({
      from:    `FincaOS <${process.env.SMTP_USER}>`,
      to:      emails.join(', '),
      subject: `[FincaOS] ${subject}`,
      html:    buildHtml(subject, content),
      text:    `${subject}\n\n${content}`,
    });

    log.info('admin_emails_sent', { comunidad_id, recipients: emails.length, subject });
  } catch (err) {
    // Fallo silencioso — el email nunca debe bloquear el flujo de negocio
    log.error('admin_email_failed', err);
  }
}

/* ── Plantilla HTML ──────────────────────────────────────────────────────── */

function buildHtml(subject: string, content: string): string {
  const safeContent = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:20px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;">
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
                        font-size:14px;line-height:1.6;color:#374151;">
              ${safeContent}
            </div>
          </td>
        </tr>
      </table>

      <!-- Footer -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#f9fafb;border-radius:0 0 16px 16px;padding:16px 24px;">
        <tr>
          <td align="center"
              style="font-size:11px;color:#9ca3af;line-height:1.5;">
            Este email fue enviado automáticamente por FincaOS.<br>
            Por favor no respondas a este mensaje.
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
</body>
</html>`;
}

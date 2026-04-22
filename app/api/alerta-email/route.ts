import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

// ── Inline AI avatar — base64 SVG (no external hosting needed) ───────────────
// A stylized brain/circuit robot face representing FincaOS AI
const AI_AVATAR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#FF6B6B"/>
      <stop offset="100%" style="stop-color:#FF8E53"/>
    </linearGradient>
  </defs>
  <!-- Background circle -->
  <circle cx="40" cy="40" r="40" fill="url(#bg)"/>
  <!-- Brain circuit icon -->
  <g fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <!-- Head outline -->
    <path d="M28 30 C28 22 52 22 52 30 L52 48 C52 54 46 58 40 58 C34 58 28 54 28 48 Z" fill="rgba(255,255,255,0.2)" stroke="white" stroke-width="2"/>
    <!-- Eyes -->
    <circle cx="34" cy="39" r="3" fill="white" stroke="none"/>
    <circle cx="46" cy="39" r="3" fill="white" stroke="none"/>
    <circle cx="34" cy="39" r="1.5" fill="#FF6B6B" stroke="none"/>
    <circle cx="46" cy="39" r="1.5" fill="#FF6B6B" stroke="none"/>
    <!-- Mouth -->
    <path d="M35 47 Q40 51 45 47" stroke="white" stroke-width="2" fill="none"/>
    <!-- Antenna -->
    <line x1="40" y1="22" x2="40" y2="16" stroke="white" stroke-width="2"/>
    <circle cx="40" cy="14" r="2.5" fill="white"/>
    <!-- Ears/signal dots -->
    <circle cx="24" cy="38" r="3" fill="rgba(255,255,255,0.5)"/>
    <circle cx="56" cy="38" r="3" fill="rgba(255,255,255,0.5)"/>
    <!-- Circuit lines on forehead -->
    <line x1="33" y1="30" x2="33" y2="26" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
    <line x1="47" y1="30" x2="47" y2="26" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
    <line x1="33" y1="26" x2="47" y2="26" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>
    <circle cx="33" cy="26" r="1.5" fill="rgba(255,255,255,0.8)"/>
    <circle cx="47" cy="26" r="1.5" fill="rgba(255,255,255,0.8)"/>
  </g>
</svg>
`.trim();

const AI_AVATAR_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(AI_AVATAR_SVG).toString('base64')}`;

// ── Email HTML template ───────────────────────────────────────────────────────

function buildEmailHtml(
  categoria: string,
  zona: string,
  mensaje: string,
  fecha: string,
): string {
  const mensajeHtml = mensaje.replace(/\n/g, '<br/>');
  const zonaLabel = zona.charAt(0).toUpperCase() + zona.slice(1).replace('_', ' ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Alerta IA — FincaOS</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF6B6B 0%,#FF8E53 100%);padding:32px 32px 24px;text-align:center;">
              <img src="${AI_AVATAR_DATA_URI}"
                   alt="FincaOS AI"
                   width="80" height="80"
                   style="border-radius:50%;border:3px solid rgba(255,255,255,0.4);margin-bottom:16px;display:block;margin-left:auto;margin-right:auto;"/>
              <h1 style="margin:0;color:white;font-size:22px;font-weight:700;letter-spacing:-0.3px;">
                ⚠️ Alerta de Patrón Detectado
              </h1>
              <p style="margin:6px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">
                Sistema de Inteligencia Artificial — FincaOS
              </p>
            </td>
          </tr>

          <!-- Zone badge -->
          <tr>
            <td style="padding:24px 32px 0;text-align:center;">
              <span style="display:inline-block;background:#fff3cd;color:#856404;border:1px solid #ffc107;border-radius:999px;padding:6px 20px;font-size:13px;font-weight:600;">
                📍 Zona: ${zonaLabel} &nbsp;·&nbsp; 🔧 ${categoria}
              </span>
            </td>
          </tr>

          <!-- Main message -->
          <tr>
            <td style="padding:20px 32px 24px;">
              <div style="background:#fff8f0;border-left:4px solid #FF6B6B;border-radius:0 8px 8px 0;padding:16px 20px;">
                <p style="margin:0;color:#333;font-size:15px;line-height:1.6;">
                  ${mensajeHtml}
                </p>
              </div>
            </td>
          </tr>

          <!-- What to do -->
          <tr>
            <td style="padding:0 32px 24px;">
              <h3 style="margin:0 0 12px;color:#1a1a1a;font-size:14px;font-weight:600;">
                ¿Qué hacer ahora?
              </h3>
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="background:#f8f9fa;border-radius:8px;padding:12px 16px;vertical-align:top;">
                    <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">
                      1. Accede a tu panel de administrador en FincaOS.<br/>
                      2. Revisa la sección <strong>Incidencias</strong> filtrada por la zona indicada.<br/>
                      3. Usa el botón <strong>"Actuar ahora"</strong> en el widget de IA para crear una inspección preventiva.<br/>
                      4. Asigna un proveedor si es necesario.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f8f9fa;padding:16px 32px;border-top:1px solid #eee;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td>
                    <p style="margin:0;font-size:11px;color:#999;line-height:1.5;">
                      <strong style="color:#FF6B6B;">FincaOS AI</strong> — Sistema de gestión inteligente de comunidades.<br/>
                      Este mensaje fue generado automáticamente el ${fecha}.
                    </p>
                  </td>
                  <td align="right" style="vertical-align:middle;">
                    <span style="display:inline-block;background:linear-gradient(135deg,#FF6B6B,#FF8E53);color:white;font-size:11px;font-weight:700;padding:4px 10px;border-radius:6px;">
                      FincaOS
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { categoria, zona, mensaje } = await req.json();

    if (!categoria || !zona || !mensaje) {
      return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 });
    }

    const adminEmail = process.env.SMTP_USER;
    if (!adminEmail) {
      return NextResponse.json({ ok: false, error: 'SMTP_USER not configured' }, { status: 500 });
    }

    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const fecha = new Date().toLocaleString('es-ES', {
      day:    '2-digit',
      month:  'long',
      year:   'numeric',
      hour:   '2-digit',
      minute: '2-digit',
    });

    await transporter.sendMail({
      from:    `"FincaOS IA 🤖" <${adminEmail}>`,
      to:      adminEmail,
      subject: `⚠️ FincaOS IA — Alerta en zona ${zona}: múltiples incidencias de ${categoria}`,
      text:    mensaje,
      html:    buildEmailHtml(categoria, zona, mensaje, fecha),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[alerta-email] Error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

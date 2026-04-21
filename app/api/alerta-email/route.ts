import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export const runtime = 'nodejs';

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
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    await transporter.sendMail({
      from: `"FincaOS Alertas" <${adminEmail}>`,
      to: adminEmail,
      subject: `⚠️ Alerta: múltiples incidencias de ${categoria} en ${zona}`,
      text: mensaje,
      html: `<p>${mensaje.replace(/\n/g, '<br/>')}</p>`,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[alerta-email] Error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

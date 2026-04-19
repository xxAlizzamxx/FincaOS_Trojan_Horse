/**
 * POST /api/notificaciones/push
 *
 * Sends FCM push notifications to all members of a community.
 *
 * Body: { comunidad_id, title, body, url? }
 *
 * Flow:
 *   1. Load all perfiles with comunidad_id == comunidad_id
 *   2. Load their FCM tokens from usuarios/{uid}/tokens/
 *   3. Send via Firebase Admin messaging.sendEachForMulticast()
 */

import { NextRequest, NextResponse } from 'next/server';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { getAdminDb } from '@/lib/firebase/admin';

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body?.comunidad_id || !body?.title || !body?.body) {
      return NextResponse.json(
        { error: 'comunidad_id, title y body son requeridos' },
        { status: 400 }
      );
    }

    const { comunidad_id, title, body: msgBody, url = '/inicio' } = body as {
      comunidad_id: string;
      title: string;
      body: string;
      url?: string;
    };

    const db = getAdminDb();

    // 1. Get all community members
    const perfilesSnap = await db
      .collection('perfiles')
      .where('comunidad_id', '==', comunidad_id)
      .get();

    if (perfilesSnap.empty) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    // 2. Collect FCM tokens
    const tokens: string[] = [];
    await Promise.all(
      perfilesSnap.docs.map(async (perfilDoc) => {
        try {
          const tokensSnap = await db
            .collection('usuarios')
            .doc(perfilDoc.id)
            .collection('tokens')
            .get();
          tokensSnap.docs.forEach((t) => {
            const token = t.data().token as string | undefined;
            if (token) tokens.push(token);
          });
        } catch {
          // user has no tokens — skip
        }
      })
    );

    if (tokens.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    // 3. Send multicast push
    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: { title, body: msgBody },
      webpush: {
        notification: {
          icon: '/navegador.png',
          badge: '/navegador.png',
          data: { url },
        },
        fcmOptions: { link: url },
      },
    });

    return NextResponse.json({
      ok: true,
      sent: response.successCount,
      failed: response.failureCount,
    });

  } catch (err: any) {
    console.error('[POST /api/notificaciones/push]', err);
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}

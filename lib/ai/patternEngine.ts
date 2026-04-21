/**
 * lib/ai/patternEngine.ts
 *
 * Core pattern-detection engine for FincaOS.
 *
 * Three public functions:
 *   extractPatterns(incidencias, ts) → PatternEngineResult   — pure, no I/O
 *   detectPatterns(comunidadId)      → PatternEngineResult   — reads Firestore
 *   saveInsights(comunidadId, result)                        — writes Firestore (merge)
 *   sendZonaCalienteNotifications(comunidadId, patrones)     — push + in-app (Admin SDK)
 *
 * Design principles:
 *   - NEVER throws to the caller — every exported function is fail-safe
 *   - Admin SDK only — no client SDK, no HTTP round-trips
 *   - Idempotent — safe to call multiple times
 *   - Anti-spam — per-zone 24h cooldown stored inside ai_insights
 */

import { getAdminDb }  from '@/lib/firebase/admin';
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum incidencias in a zone to trigger zona_caliente */
const ZONA_CALIENTE_THRESHOLD = 3;

/** How far back to look for open incidencias (days) */
const INCIDENCIA_WINDOW_DAYS = 60;

/** Do not re-notify the same zone more than once per 24 h */
const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

/** FCM multicast limit */
const FCM_BATCH_SIZE = 500;

/** States we treat as "resolved" and exclude from pattern analysis */
const RESOLVED_STATES = new Set(['resuelta', 'cerrada']);

// ── Types ───────────────────────────────────────────────────────────────────

export interface PatronDetectado {
  type:     'zona_caliente';
  zona:     string;
  count:    number;
  severity: 'warning' | 'danger';
  message:  string;
}

export interface PatternEngineResult {
  patrones:       PatronDetectado[];
  zonas_calientes: string[];
  generado_at:    string;
}

export interface NotificationResult {
  sent:    string[];   // zonas that received a notification
  skipped: string[];   // zonas that were in cooldown
}

// ── 1. Pure pattern extraction (no I/O) ─────────────────────────────────────

/**
 * Given a flat list of Firestore incidencia data objects, detects zona_caliente
 * patterns and returns a structured result.
 *
 * Pure function — no side effects, easy to unit-test.
 */
export function extractPatterns(
  incidencias: Array<Record<string, unknown>>,
  generado_at: string,
): PatternEngineResult {
  // Count open incidencias per zone
  const byZona: Record<string, number> = {};

  for (const inc of incidencias) {
    const zona = typeof inc.zona === 'string' ? inc.zona.trim() : null;
    // Skip incidencias without zone information (legacy docs)
    if (!zona) continue;
    byZona[zona] = (byZona[zona] ?? 0) + 1;
  }

  const patrones: PatronDetectado[] = [];

  for (const [zona, count] of Object.entries(byZona)) {
    if (count >= ZONA_CALIENTE_THRESHOLD) {
      patrones.push({
        type:     'zona_caliente',
        zona,
        count,
        severity: count >= 5 ? 'danger' : 'warning',
        message:  count >= 5
          ? `⚠️ Situación crítica: ${count} incidencias activas en la zona ${zona}. Requiere atención urgente.`
          : `Se han detectado ${count} incidencias activas en la zona ${zona}. Posible problema recurrente.`,
      });
    }
  }

  // Most affected zone first
  patrones.sort((a, b) => b.count - a.count);

  return {
    patrones,
    zonas_calientes: patrones.map(p => p.zona),
    generado_at,
  };
}

// ── 2. Firestore read + pattern detection ────────────────────────────────────

/**
 * Reads open incidencias from the last INCIDENCIA_WINDOW_DAYS for a community,
 * runs extractPatterns, and returns the result.
 *
 * Returns { patrones: [], zonas_calientes: [] } on any Firestore error.
 */
export async function detectPatterns(
  comunidadId: string,
): Promise<PatternEngineResult> {
  const generado_at = new Date().toISOString();

  if (!comunidadId?.trim()) {
    return { patrones: [], zonas_calientes: [], generado_at };
  }

  try {
    const db     = getAdminDb();
    const cutoff = new Date(
      Date.now() - INCIDENCIA_WINDOW_DAYS * 24 * 60 * 60 * 1_000,
    ).toISOString();

    // Single collection query — client-side filters avoid composite index requirements
    // (same approach used by /api/ai/alerts)
    const snap = await db.collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .get();

    const openRecent = snap.docs
      .map(d => d.data())
      .filter(d => {
        // Exclude resolved / closed
        if (RESOLVED_STATES.has((d.estado as string) ?? '')) return false;
        // Exclude older than window
        if (((d.created_at as string) ?? '') < cutoff) return false;
        return true;
      });

    return extractPatterns(openRecent, generado_at);
  } catch (err) {
    console.error('[patternEngine] detectPatterns error — returning empty result:', err);
    return { patrones: [], zonas_calientes: [], generado_at };
  }
}

// ── 3. Persist insights ──────────────────────────────────────────────────────

/**
 * Writes pattern results to ai_insights/{comunidadId} using merge:true so we
 * never overwrite fields written by other future modules (e.g. predictive maintenance).
 *
 * Silently swallows errors — a failed save must never crash the caller.
 */
export async function saveInsights(
  comunidadId: string,
  result:      PatternEngineResult,
): Promise<void> {
  try {
    const db = getAdminDb();
    await db.collection('ai_insights').doc(comunidadId).set(
      {
        patrones:        result.patrones,
        zonas_calientes: result.zonas_calientes,
        generado_at:     result.generado_at,
        version:         'v1',
      },
      { merge: true },
    );
  } catch (err) {
    console.error('[patternEngine] saveInsights error:', err);
  }
}

// ── 4. Notifications ─────────────────────────────────────────────────────────

/**
 * For each zona_caliente pattern, sends:
 *   a) One community notification doc  → comunidades/{id}/notificaciones/{auto}
 *   b) FCM push to all members         → via Firebase Admin Messaging
 *
 * Anti-spam: reads notified_zones from ai_insights and skips zones notified
 * within the last 24 hours. Updates the map after sending.
 *
 * Never throws — returns lists of sent / skipped zones.
 */
export async function sendZonaCalienteNotifications(
  comunidadId: string,
  patrones:    PatronDetectado[],
): Promise<NotificationResult> {
  const sent:    string[] = [];
  const skipped: string[] = [];

  if (patrones.length === 0) return { sent, skipped };

  try {
    const db  = getAdminDb();
    const now = Date.now();

    // ── a. Load anti-spam map ─────────────────────────────────────────────
    let notifiedZones: Record<string, string> = {};
    try {
      const insightSnap = await db.collection('ai_insights').doc(comunidadId).get();
      notifiedZones = (insightSnap.data()?.notified_zones as Record<string, string>) ?? {};
    } catch {
      // Can't read anti-spam map → proceed but won't update it (fail safe)
    }

    // ── b. Decide which zones actually need a notification ────────────────
    const toNotify = patrones.filter(p => {
      const last = notifiedZones[p.zona];
      if (!last) return true;                                      // never notified
      return now - new Date(last).getTime() > NOTIFICATION_COOLDOWN_MS;
    });

    patrones
      .filter(p => !toNotify.some(n => n.zona === p.zona))
      .forEach(p => skipped.push(p.zona));

    if (toNotify.length === 0) return { sent, skipped };

    // ── c. Get FCM tokens for all community members ───────────────────────
    const perfilesSnap = await db.collection('perfiles')
      .where('comunidad_id', '==', comunidadId)
      .get();

    const memberIds = perfilesSnap.docs.map(d => d.id);

    // Collect tokens in parallel — same pattern as /api/notificaciones/push
    const allTokens: string[] = [];
    if (memberIds.length > 0) {
      await Promise.all(
        memberIds.map(async uid => {
          try {
            const tokensSnap = await db
              .collection('usuarios').doc(uid).collection('tokens')
              .get();
            tokensSnap.docs.forEach(t => {
              const token = t.data().token as string | undefined;
              if (token) allTokens.push(token);
            });
          } catch {
            // User has no registered tokens — skip silently
          }
        }),
      );
    }

    // Ensure Firebase Admin app is initialised before calling getMessaging()
    // (getAdminDb() guarantees this, but guard explicitly for safety)
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
          clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
          privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
    }

    // ── d. Send per-zone ──────────────────────────────────────────────────
    for (const patron of toNotify) {
      const title = patron.severity === 'danger'
        ? '🔴 Zona crítica detectada'
        : '🟡 Alerta en tu comunidad';
      const body  = patron.severity === 'danger'
        ? `Zona ${patron.zona}: ${patron.count} incidencias activas. Requiere atención urgente.`
        : `Se detectaron ${patron.count} incidencias en la zona ${patron.zona}. Revisa la app.`;
      const link  = '/incidencias';

      // d1. In-app community notification (1 doc — all members see it via
      //     perfil.notificaciones_last_read comparison, same as quorum notifications)
      try {
        await db
          .collection('comunidades').doc(comunidadId)
          .collection('notificaciones').add({
            tipo:       'incidencia',
            titulo:     title,
            mensaje:    body,
            created_at: new Date().toISOString(),
            created_by: 'sistema_ia',
            related_id: `zona_caliente_${patron.zona}`,
            link,
          });
      } catch (err) {
        console.error('[patternEngine] In-app notification failed for zona', patron.zona, err);
        // Don't abort — still attempt push
      }

      // d2. FCM push — batched to respect the 500-token multicast limit
      if (allTokens.length > 0) {
        try {
          for (let i = 0; i < allTokens.length; i += FCM_BATCH_SIZE) {
            const batch = allTokens.slice(i, i + FCM_BATCH_SIZE);
            await getMessaging().sendEachForMulticast({
              tokens: batch,
              notification: { title, body },
              webpush: {
                notification: {
                  icon:  '/navegador.png',
                  badge: '/navegador.png',
                },
                fcmOptions: { link },
              },
            });
          }
        } catch (err) {
          console.error('[patternEngine] FCM push failed for zona', patron.zona, err);
          // In-app notification already sent — log and continue
        }
      }

      sent.push(patron.zona);
    }

    // ── e. Persist updated anti-spam map ─────────────────────────────────
    if (sent.length > 0) {
      const nowIso      = new Date().toISOString();
      const updatedMap  = { ...notifiedZones };
      sent.forEach(zona => { updatedMap[zona] = nowIso; });

      try {
        await db.collection('ai_insights').doc(comunidadId).set(
          { notified_zones: updatedMap },
          { merge: true },
        );
      } catch (err) {
        console.error('[patternEngine] Failed to update notified_zones:', err);
        // Not fatal — worst case we send again on next cycle (24 h reset missed)
      }
    }
  } catch (err) {
    console.error('[patternEngine] sendZonaCalienteNotifications outer error:', err);
    patrones.forEach(p => { if (!sent.includes(p.zona)) skipped.push(p.zona); });
  }

  return { sent, skipped };
}

/**
 * lib/ai/patternEngine.ts
 *
 * Core pattern-detection engine for FincaOS.
 *
 * Exported functions:
 *   extractPatterns(incidencias, ts) → PatternEngineResult   — pure, no I/O
 *   detectPatterns(comunidadId)      → PatternEngineResult   — reads Firestore
 *   saveInsights(comunidadId, result)                        — writes Firestore (merge)
 *   autoEscalarZonaCaliente(comunidadId, zona)               — escalates open incidencias to urgente
 *   sendZonaCalienteNotifications(comunidadId, patrones)     — push + in-app (Admin SDK)
 *
 * Design principles:
 *   - NEVER throws to the caller — every exported function is fail-safe
 *   - Admin SDK only — no client SDK, no HTTP round-trips
 *   - Idempotent — safe to call multiple times
 *   - Anti-spam — per-zone 24h cooldown stored inside ai_insights
 */

import { getAdminDb }    from '@/lib/firebase/admin';
import { normalizeZona } from '@/lib/incidencias/mapZona';
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
  patrones:            PatronDetectado[];
  zonas_calientes:     string[];
  generado_at:         string;
  score_riesgo_global: number;   // 0–100: <30 estable · 30–70 atención · >70 crítico
}

export interface NotificationResult {
  sent:    string[];   // zonas that received a notification
  skipped: string[];   // zonas that were in cooldown
}

export interface EscalationResult {
  zona:      string;
  escalated: number;   // number of incidencias updated to urgente
}

// ── Helpers (pure) ───────────────────────────────────────────────────────────

/**
 * Returns an actionable message for the given zone and incidencia count.
 * Replaces the inline template literals to keep messages consistent across
 * the widget, notifications, and Firestore documents.
 */
function generarMensaje(zona: string, count: number): string {
  if (count >= 5) {
    return (
      `⚠️ Situación crítica en zona ${zona}. ` +
      `Se detectaron ${count} incidencias. Posible problema estructural. ` +
      `Se recomienda intervención inmediata y contacto con proveedor.`
    );
  }
  return (
    `Se detectaron ${count} incidencias en zona ${zona}. ` +
    `Se recomienda inspección preventiva en las próximas 24h para evitar escalamiento.`
  );
}

/**
 * Calculates a 0–100 community risk score.
 *
 *   score = (totalOpenIncidencias × 5) + (zonasCalientes.length × 20)
 *   capped at 100
 *
 * Interpretation:
 *   🟢  < 30 → estable
 *   🟡 30–70 → atención
 *   🔴  > 70 → crítico
 */
function calcularScoreRiesgo(
  totalOpenIncidencias: number,
  zonasCalientes:       string[],
): number {
  const score = totalOpenIncidencias * 5 + zonasCalientes.length * 20;
  return Math.min(100, score);
}

// ── 1. Pure pattern extraction (no I/O) ─────────────────────────────────────

/**
 * Given a flat list of Firestore incidencia data objects, detects zona_caliente
 * patterns and returns a structured result including the global risk score.
 *
 * Pure function — no side effects, easy to unit-test.
 *
 * Count fix: uses String() coercion so zona values stored as numbers are
 * counted correctly instead of being silently dropped.
 */
export function extractPatterns(
  incidencias: Array<Record<string, unknown>>,
  generado_at: string,
): PatternEngineResult {
  // ── Count open incidencias per zone ───────────────────────────────────────
  // Primary:  inc.zona  (enum stored since the field was added to the form)
  // Fallback: normalizeZona(inc.ubicacion) for legacy docs created before
  //           the zona field existed — this is the fix for the "0 patterns"
  //           bug where all existing incidencias were silently skipped.
  const byZona: Record<string, number> = {};

  for (const inc of incidencias) {
    let zona: string | null = null;

    if (inc.zona != null) {
      // New incidencias: zona is already the canonical enum value
      zona = String(inc.zona).trim() || null;
    } else if (inc.ubicacion != null) {
      // Legacy incidencias: derive zone from free-text ubicacion field
      zona = normalizeZona(String(inc.ubicacion));
    }

    if (!zona) continue;
    byZona[zona] = (byZona[zona] ?? 0) + 1;
  }

  // ── Build patron list ─────────────────────────────────────────────────────
  const patrones: PatronDetectado[] = [];

  for (const [zona, count] of Object.entries(byZona)) {
    if (count >= ZONA_CALIENTE_THRESHOLD) {
      patrones.push({
        type:     'zona_caliente',
        zona,
        count,
        severity: count >= 5 ? 'danger' : 'warning',
        message:  generarMensaje(zona, count),
      });
    }
  }

  // Most affected zone first
  patrones.sort((a, b) => b.count - a.count);

  const zonas_calientes = patrones.map(p => p.zona);

  return {
    patrones,
    zonas_calientes,
    generado_at,
    score_riesgo_global: calcularScoreRiesgo(incidencias.length, zonas_calientes),
  };
}

// ── 2. Firestore read + pattern detection ────────────────────────────────────

/**
 * Reads open incidencias from the last INCIDENCIA_WINDOW_DAYS for a community,
 * runs extractPatterns, and returns the result.
 *
 * Returns { patrones: [], zonas_calientes: [], score_riesgo_global: 0 } on any error.
 */
export async function detectPatterns(
  comunidadId: string,
): Promise<PatternEngineResult> {
  const generado_at = new Date().toISOString();
  const empty: PatternEngineResult = {
    patrones: [], zonas_calientes: [], generado_at, score_riesgo_global: 0,
  };

  if (!comunidadId?.trim()) return empty;

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
    return empty;
  }
}

// ── 3. Persist insights ──────────────────────────────────────────────────────

/**
 * Writes pattern results to ai_insights/{comunidadId} using merge:true so we
 * never overwrite fields written by other future modules (e.g. predictive maintenance).
 *
 * Now also persists score_riesgo_global so the widget can display it without
 * recomputing.
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
        patrones:            result.patrones,
        zonas_calientes:     result.zonas_calientes,
        generado_at:         result.generado_at,
        score_riesgo_global: result.score_riesgo_global,
        version:             'v2',
      },
      { merge: true },
    );
  } catch (err) {
    console.error('[patternEngine] saveInsights error:', err);
  }
}

// ── 4. Auto-escalation ───────────────────────────────────────────────────────

/**
 * For a given zona_caliente, finds all open incidencias in that zone that are
 * NOT already urgente and escalates them:
 *
 *   prioridad   → 'urgente'
 *   escalado_por → 'sistema_ia'
 *   escalado_at  → ISO timestamp
 *
 * Uses a Firestore batch write for atomicity and efficiency.
 * Filters zona client-side (no composite index needed — consistent with
 * the rest of the engine).
 *
 * Never throws — returns { zona, escalated: 0 } on any error.
 */
export async function autoEscalarZonaCaliente(
  comunidadId: string,
  zona:        string,
): Promise<EscalationResult> {
  try {
    const db  = getAdminDb();
    const now = new Date().toISOString();

    // Query by comunidad_id only; filter zona + estado client-side
    const snap = await db.collection('incidencias')
      .where('comunidad_id', '==', comunidadId)
      .get();

    const batch = db.batch();
    let escalated = 0;

    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const docZona = data.zona != null ? String(data.zona).trim() : '';

      // Only target this zone, only open, only non-urgent
      if (
        docZona !== zona.trim() ||
        RESOLVED_STATES.has((data.estado as string) ?? '') ||
        data.prioridad === 'urgente'
      ) continue;

      batch.update(docSnap.ref, {
        prioridad:    'urgente',
        escalado_por: 'sistema_ia',
        escalado_at:  now,
      });
      escalated++;
    }

    if (escalated > 0) await batch.commit();

    return { zona, escalated };
  } catch (err) {
    console.error('[patternEngine] autoEscalarZonaCaliente error for zona', zona, err);
    return { zona, escalated: 0 };
  }
}

// ── 5. Notifications ─────────────────────────────────────────────────────────

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
      const body = patron.severity === 'danger'
        ? `Zona ${patron.zona}: ${patron.count} incidencias activas. Requiere atención urgente.`
        : `Se detectaron ${patron.count} incidencias en la zona ${patron.zona}. Revisa la app.`;
      const link = '/incidencias';

      // d1. In-app community notification
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
        }
      }

      sent.push(patron.zona);
    }

    // ── e. Persist updated anti-spam map ─────────────────────────────────
    if (sent.length > 0) {
      const nowIso     = new Date().toISOString();
      const updatedMap = { ...notifiedZones };
      sent.forEach(zona => { updatedMap[zona] = nowIso; });

      try {
        await db.collection('ai_insights').doc(comunidadId).set(
          { notified_zones: updatedMap },
          { merge: true },
        );
      } catch (err) {
        console.error('[patternEngine] Failed to update notified_zones:', err);
      }
    }
  } catch (err) {
    console.error('[patternEngine] sendZonaCalienteNotifications outer error:', err);
    patrones.forEach(p => { if (!sent.includes(p.zona)) skipped.push(p.zona); });
  }

  return { sent, skipped };
}

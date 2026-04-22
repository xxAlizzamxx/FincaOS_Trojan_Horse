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
import { sendAdminNotification } from '@/lib/email';

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
  type:            'zona_caliente' | 'categoria_caliente';
  zona:            string;
  categoria_id:    string | null;   // null = incidencias sin categoría asignada
  categoria_nombre: string;         // display name, e.g. "Fontanería" or "Sin categoría"
  count:           number;
  severity:        'warning' | 'danger';
  message:         string;
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
function generarMensaje(zona: string, count: number, categoriaNombre: string): string {
  const cat = categoriaNombre && categoriaNombre !== 'Sin categoría'
    ? ` de tipo "${categoriaNombre}"`
    : '';
  if (count >= 5) {
    return (
      `⚠️ Situación crítica en zona ${zona}${cat}. ` +
      `Se detectaron ${count} incidencias repetidas. Posible problema estructural. ` +
      `Se recomienda intervención inmediata y contacto con proveedor.`
    );
  }
  return (
    `Se detectaron ${count} incidencias${cat} en zona ${zona}. ` +
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
/**
 * @param incidencias  Flat list of Firestore incidencia data objects
 * @param generado_at  ISO timestamp for the result
 * @param categoryMap  Optional map of { [categoria_id]: nombre } for display names.
 *                     Resolved by detectPatterns(); pass {} or omit in unit tests.
 */
export function extractPatterns(
  incidencias: Array<Record<string, unknown>>,
  generado_at: string,
  categoryMap: Record<string, string> = {},
): PatternEngineResult {
  console.log('[patternEngine] extractPatterns — input count:', incidencias.length);

  // ── Count open incidencias per (zona + categoria_id) pair ─────────────────
  //
  // Key format:  "<zona>||<categoria_id>"   (|| chosen as it can't appear in either)
  // An incidencia without a categoria_id is grouped under the "<zona>||__none__" key.
  //
  // Zone resolution:
  //   Primary:  inc.zona  (enum stored since the field was added to the form)
  //   Fallback: normalizeZona(inc.ubicacion) for legacy docs without a zona field
  const byZonaCategoria: Record<string, { count: number; zona: string; categoria_id: string | null }> = {};

  for (const inc of incidencias) {
    // ─ Resolve zone ──────────────────────────────────────────────────────
    let zona: string | null = null;
    if (inc.zona != null) {
      zona = String(inc.zona).trim() || null;
    } else if (inc.ubicacion != null) {
      zona = normalizeZona(String(inc.ubicacion));
    }
    if (!zona) continue;

    // ─ Resolve category ──────────────────────────────────────────────────
    const rawCat    = inc.categoria_id != null ? String(inc.categoria_id).trim() : null;
    const catId     = rawCat || null;
    const bucketKey = `${zona}||${catId ?? '__none__'}`;

    if (!byZonaCategoria[bucketKey]) {
      byZonaCategoria[bucketKey] = { count: 0, zona, categoria_id: catId };
    }
    byZonaCategoria[bucketKey].count += 1;
  }

  // Debug: log bucket counts to verify grouping (zona + categoría)
  const bucketSummary = Object.entries(byZonaCategoria)
    .map(([k, v]) => `${k}=${v.count}`)
    .join(', ');
  console.log('[patternEngine] buckets:', bucketSummary || '(none)');
  console.log('[patternEngine] threshold:', ZONA_CALIENTE_THRESHOLD);

  // ── Build patron list ─────────────────────────────────────────────────────
  const patrones: PatronDetectado[] = [];

  for (const bucket of Object.values(byZonaCategoria)) {
    if (bucket.count < ZONA_CALIENTE_THRESHOLD) continue;

    const categoriaNombre = bucket.categoria_id
      ? (categoryMap[bucket.categoria_id] ?? bucket.categoria_id)   // fallback to raw ID
      : 'Sin categoría';

    patrones.push({
      type:             bucket.categoria_id ? 'categoria_caliente' : 'zona_caliente',
      zona:             bucket.zona,
      categoria_id:     bucket.categoria_id,
      categoria_nombre: categoriaNombre,
      count:            bucket.count,
      severity:         bucket.count >= 5 ? 'danger' : 'warning',
      message:          generarMensaje(bucket.zona, bucket.count, categoriaNombre),
    });
  }

  // Most affected first
  patrones.sort((a, b) => b.count - a.count);

  // Unique zones represented in the alert list (for the risk score + summary tags)
  // Array.from avoids downlevelIteration requirement on es5 target
  const zonas_calientes = Array.from(new Set(patrones.map(p => p.zona)));

  console.log(
    '[patternEngine] extractPatterns — result:',
    patrones.length,
    'patrones,',
    zonas_calientes.length,
    'zonas calientes:',
    zonas_calientes.join(', ') || '(ninguna)',
  );

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
    const [incSnap, catSnap] = await Promise.all([
      db.collection('incidencias')
        .where('comunidad_id', '==', comunidadId)
        .get(),
      db.collection('categorias_incidencia').get(),
    ]);

    // Build { [id]: nombre } lookup for category display names
    const categoryMap: Record<string, string> = {};
    catSnap.docs.forEach(d => {
      const data = d.data();
      if (data.nombre) categoryMap[d.id] = String(data.nombre);
    });

    const openRecent = incSnap.docs
      .map(d => d.data())
      .filter(d => {
        // Exclude resolved / closed
        if (RESOLVED_STATES.has((d.estado as string) ?? '')) return false;
        // Exclude older than window
        if (((d.created_at as string) ?? '') < cutoff) return false;
        return true;
      });

    return extractPatterns(openRecent, generado_at, categoryMap);
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
 *   b) Email to admins/presidentes     → via sendAdminNotification
 *   c) FCM push to all members         → via Firebase Admin Messaging
 *
 * Anti-spam: reads notified_zones from ai_insights and skips patterns notified
 * within the last `cooldownMs` milliseconds. Updates the map after sending.
 *
 * Key format for notified_zones: "${zona}||${categoria_id ?? '__none__'}"
 * (same as patternEngine bucket key) — so "vivienda + filtraciones" and
 * "vivienda + electricidad" get independent cooldowns.
 *
 * @param cooldownMs  Anti-spam window (default 24 h for cron, pass 1 h for manual scans)
 *
 * Never throws — returns lists of sent / skipped keys.
 */
export async function sendZonaCalienteNotifications(
  comunidadId: string,
  patrones:    PatronDetectado[],
  cooldownMs:  number = NOTIFICATION_COOLDOWN_MS,
): Promise<NotificationResult> {
  const sent:    string[] = [];
  const skipped: string[] = [];

  console.log('[patternEngine] sendZonaCalienteNotifications — patrones:', patrones.length, '| cooldownMs:', cooldownMs);

  if (patrones.length === 0) {
    console.log('[patternEngine] No patrones — skipping notifications');
    return { sent, skipped };
  }

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

    // ── b. Decide which patterns actually need a notification ─────────────
    //
    // Key includes categoria_id so "vivienda + filtraciones" and
    // "vivienda + electricidad" have independent cooldowns — without this,
    // the first category to fire blocks ALL others in the same zone for 24 h.
    const patternKey = (p: PatronDetectado) =>
      `${p.zona}||${p.categoria_id ?? '__none__'}`;

    const toNotify = patrones.filter(p => {
      const key  = patternKey(p);
      const last = notifiedZones[key] ?? notifiedZones[p.zona]; // fallback: old zone-only key
      if (!last) return true;
      return now - new Date(last).getTime() > cooldownMs;
    });

    patrones
      .filter(p => !toNotify.some(n => patternKey(n) === patternKey(p)))
      .forEach(p => {
        console.log('[patternEngine] pattern in cooldown, skipping:', patternKey(p));
        skipped.push(patternKey(p));
      });

    console.log('[patternEngine] toNotify:', toNotify.length, '| skipped (cooldown):', skipped.length);

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

    // ── d. Send per-pattern ───────────────────────────────────────────────
    for (const patron of toNotify) {
      const catLabel = patron.categoria_nombre && patron.categoria_nombre !== 'Sin categoría'
        ? ` de ${patron.categoria_nombre}`
        : '';
      const zonaLabel = patron.zona.replace(/_/g, ' ');

      const title = patron.severity === 'danger'
        ? `🔴 Alerta: múltiples incidencias${catLabel} en ${zonaLabel}`
        : `⚠️ Alerta: múltiples incidencias${catLabel} en ${zonaLabel}`;

      // Rich body with recommendation — visible to ALL users in the notifications bell
      const body = patron.severity === 'danger'
        ? `Se han detectado ${patron.count} incidencias${catLabel} en zona "${zonaLabel}" en las últimas 24h. Situación crítica — se recomienda intervención inmediata.`
        : `Se han detectado ${patron.count} incidencias${catLabel} en zona "${zonaLabel}" en las últimas 24h. Se recomienda inspección preventiva.`;

      const link = `/incidencias?zona=${encodeURIComponent(patron.zona)}`;

      // d1. In-app community notification → visible to ALL users via useNotifications hook
      try {
        await db
          .collection('comunidades').doc(comunidadId)
          .collection('notificaciones').add({
            tipo:       'incidencia',
            titulo:     title,
            mensaje:    body,
            created_at: new Date().toISOString(),
            created_by: 'sistema_ia',
            related_id: `zona_caliente_${patron.zona}_${patron.categoria_id ?? 'none'}`,
            link,
          });
        console.log('[patternEngine] In-app notification created for pattern:', patternKey(patron));
      } catch (err) {
        console.error('[patternEngine] In-app notification failed for pattern:', patternKey(patron), err);
        // Don't abort — still attempt email and push
      }

      // d2. Email alert to admin/presidente
      //
      // Subject is pattern-specific (zona + categoria) to avoid Firestore dedup
      // collision when multiple patterns fire in the same run.
      try {
        const emailSubject = patron.severity === 'danger'
          ? `🔴 Alerta: múltiples incidencias${catLabel} en ${zonaLabel}`
          : `⚠️ Alerta: múltiples incidencias${catLabel} en ${zonaLabel}`;

        const emailContent = [
          `Se han detectado ${patron.count} incidencia${patron.count !== 1 ? 's' : ''}${catLabel} en zona "${zonaLabel}" en las últimas 24h.`,
          '',
          patron.severity === 'danger'
            ? '🚨 Situación crítica — se recomienda intervención inmediata y contacto con proveedor.'
            : '📋 Se recomienda inspección preventiva en las próximas 24h para evitar escalamiento.',
          '',
          patron.message,
          '',
          '👉 Accede al panel de administración → Incidencias para gestionar la situación.',
        ].join('\n');

        console.log('[patternEngine] Sending alert email for pattern:', patternKey(patron));
        await sendAdminNotification({
          comunidad_id: comunidadId,
          subject:      emailSubject,
          content:      emailContent,
        });
      } catch (err) {
        console.error('[patternEngine] Email alert failed for pattern:', patternKey(patron), err);
      }

      // d3. FCM push — batched to respect the 500-token multicast limit
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

      sent.push(patternKey(patron));
    }

    // ── e. Persist updated anti-spam map (keyed by zona||categoria_id) ───
    if (sent.length > 0) {
      const nowIso     = new Date().toISOString();
      const updatedMap = { ...notifiedZones };
      sent.forEach(key => { updatedMap[key] = nowIso; });

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

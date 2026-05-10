/**
 * Server-side audit logging helper.
 * Writes to the `admin_logs` Firestore collection via Admin SDK.
 * Call this from API routes after performing admin actions.
 * Non-fatal: errors are logged to console but never thrown.
 */

export interface AuditParams {
  accion: string;           // e.g. 'crear_cobro', 'cancelar_cobro', 'crear_evento'
  recurso_tipo: string;     // e.g. 'cobro', 'evento', 'cuota'
  recurso_id: string;
  admin_id: string;
  comunidad_id: string;
  detalles?: Record<string, unknown>;
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const { getAdminDb } = await import('@/lib/firebase/admin');
    const db = getAdminDb();
    await db.collection('admin_logs').add({
      ...params,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    console.warn('[audit] Failed to write audit log:', e);
  }
}

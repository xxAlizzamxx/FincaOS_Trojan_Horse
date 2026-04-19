export type Rol = 'vecino' | 'presidente' | 'admin' | 'mediador';
export type EstadoIncidencia =
  | 'pendiente'      // inicial / "Reportada" en UI
  | 'en_revision'
  | 'presupuestada'
  | 'en_ejecucion'
  | 'resuelta'
  | 'aprobada'       // legacy
  | 'cerrada';       // legacy

export interface EntradaHistorialEstado {
  estado:       EstadoIncidencia;
  fecha:        string;            // ISO string
  cambiado_por: string;            // uid
}
export type PrioridadIncidencia = 'baja' | 'normal' | 'alta' | 'urgente';

export interface Comunidad {
  id: string;
  nombre: string;
  direccion: string | null;
  codigo: string;
  num_viviendas: number;
  created_at: string;
}

export interface Perfil {
  id: string;
  comunidad_id: string | null;
  nombre_completo: string;
  numero_piso: string | null;   // campo combinado legacy "Torre A · 3º · B"
  torre: string | null;         // campo individual
  piso: string | null;          // campo individual
  puerta: string | null;        // campo individual (también guardado como "apartamento")
  rol: Rol;
  coeficiente: number | null;   // % de participación según LPH (ej: 5.2 = 5.2%)
  avatar_url: string | null;
  /**
   * @deprecated Usar PerfilPrivado.telefono — este campo ya no se escribe en
   * perfiles/{uid}. Se mantiene para compatibilidad con datos existentes.
   */
  telefono?: string | null;
  created_at: string;
  updated_at: string;
  comunidad?: Comunidad;
  /** ISO timestamp: última vez que el usuario leyó las notificaciones.
   *  Notificación no leída = created_at > notificaciones_last_read */
  notificaciones_last_read?: string;
}

/* ─── Perfil privado (colección perfiles_privados/{uid}) ────────────────────
   Datos sensibles del usuario — solo accesibles por el propio usuario.
   NUNCA incluir en respuestas de API que otros usuarios puedan ver.
   Regla Firestore: allow read, write: if request.auth.uid == userId
─────────────────────────────────────────────────────────────────────────── */
export interface PerfilPrivado {
  /** UID del usuario — siempre coincide con el ID del documento */
  uid: string;
  email: string | null;
  telefono: string | null;
  plan: 'free' | 'premium' | null;
  ultimo_login: string | null;          // ISO
  preferencias_notificaciones: {
    push:  boolean;
    email: boolean;
  };
  created_at: string;
  updated_at: string;
}

/* ─── Analytics (colección analytics_events) ────────────────────────────────
   Eventos de uso del producto — sin PII, sin contenido de texto.
   Solo acciones y IDs opacos.
   Regla: read si user_id == uid; create si autenticado.
─────────────────────────────────────────────────────────────────────────── */
export type AnalyticsEventName =
  | 'login'
  | 'crear_incidencia'
  | 'marcar_afectado'
  | 'ver_incidencia'
  | 'crear_comentario'
  | 'crear_mediacion'
  | 'pago_completado'
  | 'join_community'
  | 'create_community'
  | 'register_proveedor';

export interface AnalyticsEvent {
  user_id:      string;
  comunidad_id: string | null;
  event:        AnalyticsEventName;
  created_at:   string;
  /** Solo metadatos no sensibles: IDs opacos, contadores, booleanos. */
  metadata:     Record<string, string | number | boolean>;
}

/* ─── Notificaciones de comunidad ────────────────────────────────────────────
   Subcolección: comunidades/{comunidadId}/notificaciones/{notifId}
   Un único documento por evento — NO uno por vecino.
   "No leída" se determina comparando created_at con perfil.notificaciones_last_read.
──────────────────────────────────────────────────────────────────────────── */
export type TipoNotificacion =
  | 'incidencia'
  | 'votacion'
  | 'anuncio'
  | 'documento';

export interface NotificacionComunidad {
  id         : string;
  tipo       : TipoNotificacion;
  titulo     : string;
  mensaje    : string;
  created_at : string;   // ISO — comparar con notificaciones_last_read
  created_by : string;   // uid del autor (excluido de su propio contador)
  related_id : string;   // id del objeto original
  link       : string;   // ruta de navegación al pulsar
}

export interface CategoriaIncidencia {
  id: string;
  nombre: string;
  icono: string | null;
}

export interface IncidenciaFoto {
  id: string;
  incidencia_id: string;
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Comentario {
  id: string;
  incidencia_id: string;
  autor_id: string;
  contenido: string;
  es_nota_admin: boolean;
  created_at: string;
  autor?: Perfil;
}

export interface Incidencia {
  id: string;
  comunidad_id: string;
  autor_id: string;
  categoria_id: string | null;
  titulo: string;
  descripcion: string | null;
  estado: EstadoIncidencia;
  prioridad: PrioridadIncidencia;
  ubicacion: string | null;   // texto libre legacy — usar zona para lógica
  zona?: 'vivienda' | 'jardin' | 'zonas_comunes' | 'parking' | 'otro';
  /**
   * Technical routing field — used to match incidencias with proveedor.servicios.
   * Separate from `categoria_id` which is the user-facing label.
   * If absent (legacy incidencias), proveedores ignore this doc.
   */
  tipo_problema?: string;
  estimacion_min: number | null;
  estimacion_max: number | null;
  presupuesto_proveedor: number | null;   // presupuesto real del proveedor
  proveedor_nombre: string | null;        // nombre del proveedor
  created_at: string;
  updated_at: string;
  resuelta_at: string | null;
  historial_estados?: EntradaHistorialEstado[];
  autor?: Perfil;
  categoria?: CategoriaIncidencia;
  fotos?: IncidenciaFoto[];
  comentarios?: Comentario[];
  quorum?: QuorumIncidencia;
  escalada_por_quorum?: boolean;
  prioridad_original?: PrioridadIncidencia;
}

export interface Anuncio {
  id: string;
  comunidad_id: string;
  autor_id: string;
  titulo: string;
  contenido: string;
  fijado: boolean;
  publicado_at: string;
  expires_at: string | null;
  created_at: string;
  autor?: Perfil;
}

export type TipoDocumento = 'pdf' | 'word' | 'excel';

export interface Documento {
  id: string;
  comunidad_id: string;
  subido_por: string | null;    // uid del autor
  created_by: string | null;    // alias semántico (mismo valor)
  nombre: string;
  descripcion: string | null;
  url: string;                  // downloadURL de Storage
  storage_path: string;
  tipo: TipoDocumento;
  tipo_mime: string | null;     // MIME original (retrocompatibilidad)
  created_at: string;
}

/* ─── Votaciones ─── */

export interface OpcionVotacion {
  id: string;    // uuid generado en cliente
  texto: string;
  votos: number;
  peso_total: number;  // suma de coeficientes de quienes votaron esta opción
}

export interface Votacion {
  id: string;
  comunidad_id: string;
  created_by: string;          // uid del presidente/admin
  titulo: string;
  descripcion: string | null;
  opciones: OpcionVotacion[];
  activa: boolean;
  usar_coeficientes: boolean;  // true = ponderado por LPH, false = 1 persona = 1 voto
  quorum_requerido: number | null; // % mínimo de participación (ej: 50)
  created_at: string;
  cierre_at: string | null;    // fecha opcional de cierre
}

export interface VotoUsuario {
  opcion_id: string;
  coeficiente: number; // coeficiente del votante en el momento del voto
  created_at: string;
}

/* ─── Cuotas ─── */

export type EstadoPago = 'pendiente' | 'pagado' | 'overdue';

export interface Cuota {
  id: string;
  comunidad_id: string;
  nombre: string;
  monto: number;
  fecha_limite: string;   // ISO string
  created_at: string;
}

export interface PagoCuota {
  usuario_id: string;
  estado: EstadoPago;
  fecha_pago: string | null;
}

/* ─── Proveedores ─── */

export interface Proveedor {
  id:               string;
  nombre:           string;
  promedio_rating:  number;   // 0–5, recalculado en cada review
  total_reviews:    number;
  created_at:       string;
}

export interface ProveedorReview {
  id:           string;
  user_id:      string;
  incidencia_id: string;
  rating:       number;       // 1–5
  comentario:   string;
  created_at:   string;
}

/* ─── Mediaciones ─── */

export type EstadoMediacion = 'solicitada' | 'asignada' | 'en_proceso' | 'finalizada';
export type EstadoPagoMediacion = 'pendiente' | 'pagado';

export interface EntradaHistorialMediacion {
  estado: EstadoMediacion;
  fecha: string;       // ISO string
  usuario_id: string;
  nota?: string;
}

/* ─── Quórum ─── */
export type TipoQuorum =
  | 'simple'        // >X% de afectados de la incidencia
  | 'absoluta'      // >50% de TODOS los vecinos
  | 'cualificada'   // ≥66.6% (LPH obras accesibilidad)
  | 'unanimidad'    // 100%
  | 'lph_ponderado';// % coeficientes LPH

export interface QuorumIncidencia {
  tipo: TipoQuorum;
  umbral: number;              // % requerido (ej: 30)
  afectados_count: number;
  peso_afectados: number;      // suma coeficientes afectados
  alcanzado: boolean;
  alcanzado_at: string | null; // ISO
}

export interface Mediacion {
  id: string;
  comunidad_id: string;
  solicitado_por: string;      // uid vecino (alias de denunciante_id)
  denunciante_id?: string;     // campo legacy
  tipo: 'ia' | 'profesional';
  estado: EstadoMediacion;
  mediador_id: string | null;
  precio_min: number;
  precio_max: number;
  precio_acordado: number | null;
  estado_pago: EstadoPagoMediacion;
  descripcion?: string;
  propuesta_ia?: string;
  es_anonimo?: boolean;
  historial?: EntradaHistorialMediacion[];
  pago?: {
    estado: string;
    precio_final: number | null;
    stripe_session_id: string | null;
    paid_at: string | null;
  };
  created_at: string;
  updated_at: string;
}

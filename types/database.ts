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
  telefono: string | null;
  created_at: string;
  updated_at: string;
  comunidad?: Comunidad;
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
  ubicacion: string | null;
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

export type EstadoPago = 'pendiente' | 'pagado';

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

/* ─── Mediaciones ─── */

export type EstadoMediacion = 'solicitada' | 'asignada' | 'en_proceso' | 'finalizada';
export type EstadoPagoMediacion = 'pendiente' | 'pagado';

export interface EntradaHistorialMediacion {
  estado: EstadoMediacion;
  fecha: string;       // ISO string
  usuario_id: string;
  nota?: string;
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

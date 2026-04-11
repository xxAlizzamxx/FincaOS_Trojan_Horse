export type Rol = 'vecino' | 'presidente' | 'admin';
export type EstadoIncidencia = 'pendiente' | 'en_revision' | 'presupuestada' | 'aprobada' | 'en_ejecucion' | 'resuelta' | 'cerrada';
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
  numero_piso: string | null;
  rol: Rol;
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
  created_at: string;
  updated_at: string;
  resuelta_at: string | null;
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

export interface Documento {
  id: string;
  comunidad_id: string;
  subido_por: string | null;
  nombre: string;
  descripcion: string | null;
  storage_path: string;
  tipo_mime: string | null;
  created_at: string;
}

/**
 * Motor de workflow para incidencias — FincaOS
 *
 * Flujo único y ordenado (sin saltos, sin retrocesos):
 *   pendiente → en_revision → presupuestada → en_ejecucion → resuelta
 *
 * "pendiente" es el valor en BD; la UI lo muestra como "Reportada".
 */

import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { EstadoIncidencia } from '@/types/database';

/* ─── Mapa de transiciones válidas ─── */
export const SIGUIENTE_ESTADO: Partial<Record<string, EstadoIncidencia>> = {
  pendiente:    'en_revision',
  en_revision:  'presupuestada',
  presupuestada:'en_ejecucion',
  en_ejecucion: 'resuelta',
  // aprobada y cerrada son estados legacy, no tienen siguiente en el nuevo flujo
};

/* ─── Configuración visual y textual de cada estado ─── */
export const ESTADO_CONFIG: Record<string, {
  label:      string;
  badge:      string;       // clases Tailwind para el Badge
  dot:        string;       // punto de color en lista
  step:       number;       // posición en la barra de progreso (1–5)
}> = {
  pendiente:    { label: 'Reportada',    badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', dot: 'bg-yellow-500', step: 1 },
  en_revision:  { label: 'En revisión', badge: 'bg-blue-100 text-blue-700 border-blue-200',        dot: 'bg-blue-500',   step: 2 },
  presupuestada:{ label: 'Presupuestada',badge: 'bg-orange-100 text-orange-700 border-orange-200', dot: 'bg-orange-500', step: 3 },
  en_ejecucion: { label: 'En ejecución',badge: 'bg-purple-100 text-purple-700 border-purple-200', dot: 'bg-purple-500', step: 4 },
  resuelta:     { label: 'Resuelta',    badge: 'bg-green-100 text-green-700 border-green-200',     dot: 'bg-green-500',  step: 5 },
  // legacy
  aprobada:     { label: 'Aprobada',    badge: 'bg-teal-100 text-teal-700 border-teal-200',        dot: 'bg-teal-500',   step: 3 },
  cerrada:      { label: 'Cerrada',     badge: 'bg-gray-100 text-gray-500 border-gray-200',        dot: 'bg-gray-400',   step: 5 },
};

/* ─── Botón de acción por estado actual ─── */
export const ACCION_ESTADO: Partial<Record<string, { label: string; descripcion: string }>> = {
  pendiente:    { label: 'Pasar a revisión',  descripcion: 'El equipo técnico revisará la incidencia' },
  en_revision:  { label: 'Presupuestar',      descripcion: 'Añadir estimación de coste y tiempo'      },
  presupuestada:{ label: 'Iniciar ejecución', descripcion: 'Confirmar que los trabajos han comenzado'  },
  en_ejecucion: { label: 'Marcar resuelta',   descripcion: 'Confirmar que la incidencia está resuelta' },
};

/* ─── Roles autorizados ─── */
export const ROLES_GESTION = ['admin', 'presidente'] as const;
export type RolGestion = typeof ROLES_GESTION[number];

export function puedeGestionar(rol?: string): boolean {
  return ROLES_GESTION.includes(rol as RolGestion);
}

/* ─── Entrada de historial ─── */
export interface EntradaHistorial {
  estado:      EstadoIncidencia;
  fecha:       string;
  cambiado_por:string;   // uid
}

/* ─── Función principal de transición ─── */
export async function actualizarEstadoIncidencia(
  incidenciaId: string,
  estadoActual: string,
  userId:       string,
): Promise<EstadoIncidencia> {

  // 1. Calcular siguiente estado
  const nuevoEstado = SIGUIENTE_ESTADO[estadoActual];
  if (!nuevoEstado) {
    throw new Error(
      `El estado "${estadoActual}" no tiene transición válida o ya es el estado final.`
    );
  }

  // 2. Entrada para el historial
  const entrada: EntradaHistorial = {
    estado:       nuevoEstado,
    fecha:        new Date().toISOString(),
    cambiado_por: userId,
  };

  // 3. Actualizar Firestore de forma atómica
  await updateDoc(doc(db, 'incidencias', incidenciaId), {
    estado:            nuevoEstado,
    updated_at:        new Date().toISOString(),
    historial_estados: arrayUnion(entrada),   // append al array sin sobrescribir
  });

  return nuevoEstado;
}

/* ─── Steps para la barra de progreso visual ─── */
export const WORKFLOW_STEPS = [
  'Reportada',
  'En revisión',
  'Presupuestada',
  'En ejecución',
  'Resuelta',
];

/* ─── Orden numérico de prioridad ─── */
export const PRIORIDAD_ORDEN: Record<string, number> = {
  urgente: 3,
  alta:    2,
  normal:  1,
  baja:    0,
};

/**
 * Ordena incidencias de mayor a menor prioridad (urgente primero).
 * Devuelve una copia del array — no muta el original.
 */
export function sortByPrioridad<T extends { prioridad: string }>(list: T[]): T[] {
  return [...list].sort(
    (a, b) => (PRIORIDAD_ORDEN[b.prioridad] ?? 0) - (PRIORIDAD_ORDEN[a.prioridad] ?? 0),
  );
}

/**
 * mapZona.ts — Sistema de zonas estricto para incidencias.
 *
 * La zona es un ENUM de 5 valores fijos. Nunca se almacena texto libre.
 * normalizeZona() convierte cualquier string (campo legacy, input IA, etc.)
 * al valor canónico correcto.
 */

export type Zona =
  | 'vivienda'
  | 'jardin'
  | 'zonas_comunes'
  | 'parking'
  | 'otro';

export const ZONAS_ORDENADAS: Zona[] = [
  'vivienda',
  'jardin',
  'zonas_comunes',
  'parking',
  'otro',
];

export const ZONA_META: Record<Zona, { label: string; emoji: string }> = {
  vivienda:      { label: 'Vivienda',       emoji: '🏠' },
  jardin:        { label: 'Jardín',         emoji: '🌿' },
  zonas_comunes: { label: 'Zonas comunes',  emoji: '🏢' },
  parking:       { label: 'Parking',        emoji: '🅿️' },
  otro:          { label: 'Otro',           emoji: '📍' },
};

/**
 * Convierte CUALQUIER string (libre o enum) al valor canónico Zona.
 * Orden de prioridad: match exacto → keywords → fallback 'otro'.
 */
export function normalizeZona(input: string | null | undefined): Zona {
  if (!input) return 'otro';
  const v = input.toLowerCase().trim();

  // Match exacto del enum (el caso más frecuente para datos nuevos)
  if (v === 'vivienda')      return 'vivienda';
  if (v === 'jardin')        return 'jardin';
  if (v === 'zonas_comunes') return 'zonas_comunes';
  if (v === 'parking')       return 'parking';
  if (v === 'otro')          return 'otro';

  // Jardín primero — "Jardín" y "jardín" deben ir aquí, no a zonas_comunes
  if (v.includes('jard'))                           return 'jardin';
  if (v.includes('garden'))                         return 'jardin';

  // Vivienda
  if (v.includes('vivienda') || v.includes('casa') || v.includes('apartamento') || v.includes('piso') || v.includes('mi vivienda')) return 'vivienda';

  // Parking
  if (v.includes('parking') || v.includes('garaje') || v.includes('garage') || v.includes('garaje')) return 'parking';

  // Zonas comunes — genérico, captura "zona común", "portal", "piscina", etc.
  if (v.includes('comun') || v.includes('común') || v.includes('zona') ||
      v.includes('portal') || v.includes('entrada') || v.includes('piscina') ||
      v.includes('escalera') || v.includes('ascensor') || v.includes('rellano')) return 'zonas_comunes';

  return 'otro';
}

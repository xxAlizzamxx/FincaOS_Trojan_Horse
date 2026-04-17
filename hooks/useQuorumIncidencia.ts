'use client';

import { useMemo } from 'react';
import type { Incidencia } from '@/types/database';

export function useQuorumIncidencia(
  incidencia: Incidencia,
  totalVecinos: number,
) {
  return useMemo(() => {
    const afectados = incidencia.quorum?.afectados_count ?? 0;
    const umbral    = incidencia.quorum?.umbral ?? 30;
    const porcentaje = totalVecinos > 0
      ? Math.round((afectados / totalVecinos) * 100)
      : 0;
    const alcanzado = incidencia.quorum?.alcanzado ?? (porcentaje >= umbral);
    const falta = Math.max(0, Math.ceil((umbral / 100) * totalVecinos) - afectados);

    return { afectados, porcentaje, umbral, alcanzado, falta, totalVecinos };
  }, [incidencia, totalVecinos]);
}

import type { TipoQuorum } from '@/types/database';

export interface ConfigQuorum {
  tipo: TipoQuorum;
  umbral: number;
  usarCoeficientes: boolean;
  totalVecinos: number;
  totalCoeficientes: number;
}

export interface ResultadoQuorum {
  porcentaje: number;
  alcanzado: boolean;
  votos: number;
  pesoActual: number;
  falta: number;
}

export function calcularQuorum(
  config: ConfigQuorum,
  votosActuales: number,
  pesoActual: number,
): ResultadoQuorum {
  const base = config.usarCoeficientes ? config.totalCoeficientes : config.totalVecinos;
  const valor = config.usarCoeficientes ? pesoActual : votosActuales;
  const porcentaje = base > 0 ? (valor / base) * 100 : 0;

  return {
    porcentaje: Math.round(porcentaje * 10) / 10,
    alcanzado: porcentaje >= config.umbral,
    votos: votosActuales,
    pesoActual,
    falta: Math.max(0, Math.ceil(((config.umbral / 100) * base) - valor)),
  };
}

// Umbrales de activación de funcionalidades según vecinos registrados
export const UMBRALES_COMUNIDAD = {
  basico:    { pct: 30, desbloquea: ['votaciones', 'anuncios'] },
  operativo: { pct: 50, desbloquea: ['mediaciones', 'cuotas'] },
  avanzado:  { pct: 75, desbloquea: ['estadisticas', 'exportar_actas'] },
  completo:  { pct: 90, desbloquea: ['ai_analisis', 'informes_anuales'] },
} as const;

export function nivelActivacion(vecinosRegistrados: number, numViviendas: number) {
  const pct = numViviendas > 0 ? (vecinosRegistrados / numViviendas) * 100 : 0;
  return Object.entries(UMBRALES_COMUNIDAD)
    .filter(([, v]) => pct >= v.pct)
    .map(([k]) => k);
}

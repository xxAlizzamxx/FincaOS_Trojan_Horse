/**
 * Mapa central de eventos → archivo de sonido.
 * Añade aquí cualquier nuevo evento; el resto del sistema lo recoge automáticamente.
 *
 * Archivos requeridos en /public/sounds/ :
 *   incidencia.mp3 | mediacion.mp3 | voto.mp3
 *   tablon.mp3     | pago.mp3      | documento.mp3
 *
 * Fuentes de sonidos gratuitos recomendadas:
 *   https://mixkit.co/free-sound-effects/
 *   https://freesound.org
 */

export const SOUND_MAP = {
  incidencia_creada:   { src: '/sounds/incidencia.mp3',  volume: 0.6 },
  mediacion_iniciada:  { src: '/sounds/mediacion.mp3',   volume: 0.5 },
  voto_emitido:        { src: '/sounds/voto.mp3',        volume: 0.5 },
  publicacion_tablon:  { src: '/sounds/tablon.mp3',      volume: 0.6 },
  pago_realizado:      { src: '/sounds/pago.mp3',        volume: 0.7 },
  documento_publicado: { src: '/sounds/documento.mp3',   volume: 0.5 },
  mensaje_recibido:    { src: '/sounds/mensaje.mp3',     volume: 0.5 },
  notificacion_nueva:  { src: '/sounds/notif.mp3',       volume: 0.4 },
  alerta_comunidad:    { src: '/sounds/alerta.mp3',      volume: 0.8 },
} as const;

export type SoundEvent = keyof typeof SOUND_MAP;

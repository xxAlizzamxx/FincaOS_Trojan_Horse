/**
 * SoundManager v2 — fixes aplicados:
 *
 * BUG 1 FIXED: Unlock ahora usa un Audio element silencioso (data URI)
 *              que realmente desbloquea HTMLAudioElement en iOS/Chrome.
 *              AudioContext unlock solo aplica a AudioContext, no a HTMLAudioElement.
 *
 * BUG 2 FIXED: Tonos sintetizados via Web Audio API como fuente primaria.
 *              No depende de archivos .mp3 externos. Si existen, se usan;
 *              si no, se usa el tono sintetizado de fallback.
 *
 * BUG 3 FIXED: GSAP es opcional. Si no está instalado, se usa CSS animation
 *              (clases .sound-pop / .sound-shake / .sound-glow de globals.css).
 *
 * BUG 4 FIXED: playWithEffect ya no traga todos los errores — logea en DEBUG.
 */

import { SOUND_MAP, SoundEvent } from './sounds';

const LS_KEY   = 'fincaos_sound_enabled';
const DEBUG    = process.env.NODE_ENV === 'development';

function log(...args: unknown[]) {
  if (DEBUG) console.log('[SoundManager]', ...args);
}
function warn(...args: unknown[]) {
  if (DEBUG) console.warn('[SoundManager]', ...args);
}

/* ─── Configuración de tonos sintetizados por evento ─── */
type ToneConfig = { freq: number[]; dur: number; type: OscillatorType; gain: number };

const TONES: Record<SoundEvent, ToneConfig> = {
  incidencia_creada:   { freq: [880, 660],       dur: 0.15, type: 'sine',     gain: 0.35 },
  mediacion_iniciada:  { freq: [440, 550, 660],   dur: 0.12, type: 'sine',     gain: 0.30 },
  voto_emitido:        { freq: [600],             dur: 0.08, type: 'square',   gain: 0.20 },
  publicacion_tablon:  { freq: [523, 659],        dur: 0.18, type: 'sine',     gain: 0.28 },
  pago_realizado:      { freq: [523, 659, 784],   dur: 0.14, type: 'sine',     gain: 0.40 },
  documento_publicado: { freq: [440, 550],        dur: 0.12, type: 'triangle', gain: 0.25 },
};

/* ─── Tipos públicos ─── */
export type AnimationEffect = (el?: Element | null) => void;

/* ─── CSS animation helper (fallback cuando GSAP no está disponible) ─── */
function cssAnimate(el: Element | null | undefined, cls: string) {
  if (!el) { warn('cssAnimate: element is null'); return; }
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/* ─── Silencio en data URI para el unlock de HTMLAudioElement ─── */
// mp3 de 0.1 s de silencio codificado en base64
const SILENT_MP3 =
  'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGhlcXVlLm9yZwBURU5DAAAAHQAAA1N3aXRjaCBQbHVzIMKpIE5DSCBTb2Z0d2FyZQBUSVQyAAAABgAAAzIyMzUAVFNTRQAAAA8AAANMYXZmNTcuODMuMTAwAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';

class SoundManager {
  private cache       = new Map<SoundEvent, HTMLAudioElement>();
  private _enabled    = true;
  private _unlocked   = false;
  private _audioCtx   : AudioContext | null = null;

  /* ────────────────────────────────────────────────
     INIT — llamar una vez desde SoundProvider
  ──────────────────────────────────────────────── */
  init() {
    if (typeof window === 'undefined') return;

    /* Recuperar preferencia guardada */
    const saved = localStorage.getItem(LS_KEY);
    this._enabled = saved !== null ? saved === 'true' : true;
    log('init() — enabled:', this._enabled);

    /* ── Unlock correcto para HTMLAudioElement ──
       Necesita reproducir un Audio() dentro del handler síncrono del gesto.
       AudioContext.createBuffer() NO desbloquea HTMLAudioElement. */
    const unlock = () => {
      if (this._unlocked) return;

      /* Reproducir silencio para desbloquear HTMLAudioElement */
      const silence = new Audio(SILENT_MP3);
      silence.volume = 0;
      silence.play()
        .then(() => {
          this._unlocked = true;
          log('Autoplay unlocked ✓');
        })
        .catch((e) => warn('Unlock failed (normal en primer intento):', e.message));

      /* Inicializar AudioContext para tonos sintetizados */
      try {
        this._audioCtx = new AudioContext();
        if (this._audioCtx.state === 'suspended') {
          this._audioCtx.resume().then(() => log('AudioContext resumed ✓'));
        }
      } catch (e) {
        warn('AudioContext init failed:', e);
      }
    };

    window.addEventListener('click',      unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
    window.addEventListener('keydown',    unlock, { once: true });

    log('init() completo. Esperando primer gesto para unlock.');
  }

  /* ────────────────────────────────────────────────
     PLAY — reproduce un evento de sonido
     Intenta MP3 primero; si falla, usa tono sintetizado.
  ──────────────────────────────────────────────── */
  play(event: SoundEvent): void {
    if (typeof window === 'undefined') return;
    if (!this._enabled) { log('play() ignorado — sonido desactivado'); return; }

    log('play()', event);

    const config = SOUND_MAP[event];
    if (!config) { warn('Evento desconocido:', event); return; }

    /* Intentar reproducir MP3 */
    this._playMp3(event, config.src, config.volume);

    /* Disparar custom event (para listeners de GSAP / animaciones externas) */
    window.dispatchEvent(new CustomEvent(`sound:${event}`, { detail: { event } }));
  }

  private _playMp3(event: SoundEvent, src: string, volume: number) {
    try {
      if (!this.cache.has(event)) {
        const audio  = new Audio(src);
        audio.volume = volume;
        audio.preload = 'auto';

        /* Detectar 404 o error de carga → fallback a tono sintetizado */
        audio.addEventListener('error', () => {
          warn(`MP3 no encontrado: ${src} → usando tono sintetizado`);
          this.cache.delete(event);         // limpia caché para reintentar si se añade el archivo
          this._playTone(event);
        }, { once: true });

        this.cache.set(event, audio);
      }

      const audio        = this.cache.get(event)!;
      audio.currentTime  = 0;

      const promise = audio.play();
      if (promise) {
        promise
          .then(() => log('MP3 reproducido:', src))
          .catch((e) => {
            warn('MP3 play() falló, usando tono sintetizado:', e.message);
            this._playTone(event);
          });
      }
    } catch (e) {
      warn('_playMp3 excepción:', e);
      this._playTone(event);
    }
  }

  /* ─── Web Audio API: tono sintetizado (fallback) ─── */
  private _playTone(event: SoundEvent) {
    const tone = TONES[event];
    if (!tone) return;

    try {
      /* Crear o reutilizar el AudioContext */
      if (!this._audioCtx) {
        this._audioCtx = new AudioContext();
      }
      if (this._audioCtx.state === 'suspended') {
        this._audioCtx.resume();
      }

      const ctx  = this._audioCtx;
      const now  = ctx.currentTime;
      const step = tone.dur;

      tone.freq.forEach((freq, i) => {
        const osc   = ctx.createOscillator();
        const gain  = ctx.createGain();

        osc.type      = tone.type;
        osc.frequency.setValueAtTime(freq, now + i * step);

        gain.gain.setValueAtTime(0, now + i * step);
        gain.gain.linearRampToValueAtTime(tone.gain, now + i * step + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * step + step);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + i * step);
        osc.stop(now + i * step + step + 0.02);
      });

      log('Tono sintetizado reproducido:', event, tone.freq);
    } catch (e) {
      warn('_playTone falló:', e);
    }
  }

  /* ────────────────────────────────────────────────
     playWithEffect — sonido + animación
     GSAP opcional: si no está instalado usa CSS animation
  ──────────────────────────────────────────────── */
  playWithEffect(event: SoundEvent, effect: AnimationEffect, el?: Element | null): void {
    this.play(event);

    if (!el) {
      warn('playWithEffect: el es null — ¿pasaste el ref correctamente?');
    }

    /* Ejecutar el effect del caller (puede usar GSAP o CSS) */
    try {
      effect(el);
    } catch (e) {
      /* GSAP no instalado → fallback a CSS pop */
      warn('effect() falló (¿GSAP no instalado?):', (e as Error).message, '→ usando CSS fallback');
      cssAnimate(el, 'sound-pop');
    }
  }

  /**
   * playWithCss — versión simplificada que no requiere GSAP.
   * Aplica una clase CSS animation directamente.
   *
   * @param cls  'sound-pop' | 'sound-shake' | 'sound-glow'
   */
  playWithCss(event: SoundEvent, el: Element | null | undefined, cls: 'sound-pop' | 'sound-shake' | 'sound-glow' = 'sound-pop') {
    this.play(event);
    cssAnimate(el, cls);
  }

  /* ── Control de estado ── */
  toggle(): boolean {
    this._enabled = !this._enabled;
    this._persist();
    log('toggle() →', this._enabled);
    window.dispatchEvent(new CustomEvent('sound:toggle', { detail: { enabled: this._enabled } }));
    return this._enabled;
  }

  setEnabled(val: boolean) {
    this._enabled = val;
    this._persist();
    window.dispatchEvent(new CustomEvent('sound:toggle', { detail: { enabled: val } }));
  }

  get enabled() { return this._enabled; }

  /* ── Precarga ── */
  preload(...events: SoundEvent[]) {
    if (typeof window === 'undefined') return;
    events.forEach((event) => {
      if (this.cache.has(event)) return;
      const config = SOUND_MAP[event];
      const audio  = new Audio(config.src);
      audio.volume = config.volume;
      audio.preload = 'auto';
      audio.addEventListener('error', () => warn(`Preload 404: ${config.src}`), { once: true });
      audio.addEventListener('canplaythrough', () => log(`Preloaded: ${config.src}`), { once: true });
      this.cache.set(event, audio);
    });
  }

  private _persist() {
    try { localStorage.setItem(LS_KEY, String(this._enabled)); } catch {}
  }
}

export const soundManager = new SoundManager();

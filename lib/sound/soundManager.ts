/**
 * SoundManager — singleton centralizado de audio.
 *
 * Características:
 *  · Lazy-loading: los archivos solo se cargan cuando se reproducen por primera vez.
 *  · Autoplay unlock: resuelve la política de autoplay de los navegadores
 *    escuchando el primer gesto del usuario.
 *  · Persistencia: el estado enabled/disabled se guarda en localStorage.
 *  · Custom events: cada play dispara `sound:<eventName>` en window
 *    para que GSAP u otros listeners puedan reaccionar.
 *  · GSAP opcional: si window.gsap está disponible, se pueden pasar
 *    callbacks de animación junto al sonido.
 */

import { SOUND_MAP, SoundEvent } from './sounds';

const LS_KEY = 'fincaos_sound_enabled';

/* ─── Tipos públicos ─── */
export type AnimationEffect = (el?: Element | null) => void;

class SoundManager {
  private cache    = new Map<SoundEvent, HTMLAudioElement>();
  private _enabled = true;
  private _unlocked = false;

  /* ── Inicializar (llamar una vez al montar la app) ── */
  init() {
    if (typeof window === 'undefined') return;

    /* Recuperar preferencia guardada */
    const saved = localStorage.getItem(LS_KEY);
    this._enabled = saved !== null ? saved === 'true' : true;

    /* Desbloquear autoplay en el primer gesto del usuario */
    const unlock = () => {
      if (this._unlocked) return;
      this._unlocked = true;

      /* Crear y reproducir un AudioContext vacío para "activar" el contexto */
      try {
        const ctx = new AudioContext();
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        ctx.close();
      } catch {}

      window.removeEventListener('click',      unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown',    unlock);
    };

    window.addEventListener('click',      unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
    window.addEventListener('keydown',    unlock, { once: true });
  }

  /* ── Reproducir un evento de sonido ── */
  play(event: SoundEvent): void {
    if (typeof window === 'undefined') return;
    if (!this._enabled) return;

    const config = SOUND_MAP[event];
    if (!config) return;

    try {
      /* Lazy-load: crear el elemento Audio solo la primera vez */
      if (!this.cache.has(event)) {
        const audio = new Audio(config.src);
        audio.volume = config.volume;
        audio.preload = 'auto';
        this.cache.set(event, audio);
      }

      const audio = this.cache.get(event)!;

      /* Reiniciar si ya estaba reproduciéndose */
      audio.currentTime = 0;

      const promise = audio.play();
      if (promise !== undefined) {
        promise.catch(() => {
          /* Silenciar error de autoplay — el usuario no ha interactuado aún */
        });
      }

      /* Disparar custom event para que GSAP u otros listeners reaccionen */
      window.dispatchEvent(new CustomEvent(`sound:${event}`, { detail: { event } }));

    } catch {
      /* Nunca romper la UI por un error de audio */
    }
  }

  /**
   * playWithEffect — reproduce un sonido Y ejecuta un callback de animación.
   * Si GSAP está disponible globalmente, el callback puede usarlo directamente.
   *
   * Ejemplo:
   *   soundManager.playWithEffect('pago_realizado', (el) => {
   *     gsap.from(el, { scale: 1.3, duration: 0.4, ease: 'back.out' });
   *   }, document.getElementById('pay-btn'));
   */
  playWithEffect(event: SoundEvent, effect: AnimationEffect, el?: Element | null): void {
    this.play(event);
    try { effect(el); } catch {}
  }

  /* ── Control de estado ── */
  toggle(): boolean {
    this._enabled = !this._enabled;
    this._persist();
    window.dispatchEvent(new CustomEvent('sound:toggle', { detail: { enabled: this._enabled } }));
    return this._enabled;
  }

  setEnabled(val: boolean): void {
    this._enabled = val;
    this._persist();
    window.dispatchEvent(new CustomEvent('sound:toggle', { detail: { enabled: val } }));
  }

  get enabled(): boolean { return this._enabled; }

  /* ── Precarga manual (opcional, para preparar assets críticos) ── */
  preload(...events: SoundEvent[]): void {
    if (typeof window === 'undefined') return;
    events.forEach((event) => {
      if (this.cache.has(event)) return;
      const config = SOUND_MAP[event];
      const audio = new Audio(config.src);
      audio.volume = config.volume;
      audio.preload = 'auto';
      this.cache.set(event, audio);
    });
  }

  private _persist() {
    try { localStorage.setItem(LS_KEY, String(this._enabled)); } catch {}
  }
}

/* Singleton — exportar una sola instancia para toda la app */
export const soundManager = new SoundManager();

/**
 * Ejemplos de integración del sistema de sonido en cada módulo.
 * Este archivo es solo documentación — copia los snippets donde los necesites.
 *
 * ─────────────────────────────────────────────────────────────────
 * PATRÓN 1 — Solo sonido (sin animación)
 * ─────────────────────────────────────────────────────────────────
 *
 *   import { useSound } from '@/hooks/useSound';
 *
 *   const { play } = useSound();
 *
 *   // Al crear una incidencia:
 *   await addDoc(collection(db, 'incidencias'), { ... });
 *   play('incidencia_creada');
 *
 *   // Al emitir un voto:
 *   await updateDoc(votacionRef, { ... });
 *   play('voto_emitido');
 *
 *   // Al realizar un pago (en el webhook de Stripe ya está en servidor,
 *   // aquí lo disparas en la página /pago/exito):
 *   play('pago_realizado');
 *
 *
 * ─────────────────────────────────────────────────────────────────
 * PATRÓN 2 — Sonido + animación CSS (sin GSAP)
 * ─────────────────────────────────────────────────────────────────
 *
 *   const { playWithEffect } = useSound();
 *   const btnRef = useRef<HTMLButtonElement>(null);
 *
 *   // El efecto añade una clase CSS que dispara una animación keyframe
 *   playWithEffect('voto_emitido', (el) => {
 *     if (!el) return;
 *     el.classList.add('animate-bounce-once');
 *     el.addEventListener('animationend', () => el.classList.remove('animate-bounce-once'), { once: true });
 *   }, btnRef.current);
 *
 *   // En globals.css añade:
 *   // @keyframes bounce-once { 0%,100% { transform: scale(1) } 50% { transform: scale(1.15) } }
 *   // .animate-bounce-once { animation: bounce-once 0.35s ease; }
 *
 *
 * ─────────────────────────────────────────────────────────────────
 * PATRÓN 3 — Sonido + animación GSAP (requiere instalar gsap)
 * ─────────────────────────────────────────────────────────────────
 *
 *   // 1. Instalar: npm install gsap
 *   // 2. Importar en el componente:
 *   import { gsap } from 'gsap';
 *
 *   const { playWithEffect } = useSound();
 *
 *   playWithEffect('pago_realizado', (el) => {
 *     if (!el) return;
 *     gsap.timeline()
 *       .from(el, { scale: 0.8, opacity: 0.5, duration: 0.25, ease: 'back.out(2)' })
 *       .to(el,   { scale: 1,   opacity: 1,   duration: 0.15 });
 *   }, payButtonRef.current);
 *
 *
 * ─────────────────────────────────────────────────────────────────
 * PATRÓN 4 — Escuchar eventos desde cualquier componente (sin hook)
 * ─────────────────────────────────────────────────────────────────
 *
 *   // Útil para animaciones globales desacopladas del componente que dispara el sonido
 *   useEffect(() => {
 *     const handler = () => {
 *       gsap.to('.fab-button', { rotate: 15, yoyo: true, repeat: 1, duration: 0.2 });
 *     };
 *     window.addEventListener('sound:incidencia_creada', handler);
 *     return () => window.removeEventListener('sound:incidencia_creada', handler);
 *   }, []);
 *
 *
 * ─────────────────────────────────────────────────────────────────
 * PATRÓN 5 — Desde código no-React (API routes, utils, etc.)
 * ─────────────────────────────────────────────────────────────────
 *
 *   import { soundManager } from '@/lib/sound/soundManager';
 *
 *   // En cualquier función async del cliente:
 *   soundManager.play('documento_publicado');
 *
 */

export {};

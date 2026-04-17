'use client';

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallBanner() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible]         = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      const bip = e as BeforeInstallPromptEvent;
      setPromptEvent(bip);
      const dismissed = localStorage.getItem('pwa-install-dismissed');
      if (!dismissed) setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  function dismiss() {
    setVisible(false);
    localStorage.setItem('pwa-install-dismissed', '1');
  }

  async function instalar() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') setVisible(false);
  }

  if (!visible || !promptEvent) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-in slide-in-from-bottom-4 duration-300">
      <div className="bg-finca-dark text-white rounded-2xl shadow-2xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <img src="/navegador.png" alt="FincaOS" className="w-10 h-10 rounded-xl shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Instalar FincaOS</p>
            <p className="text-xs text-white/70">Acceso rápido desde tu pantalla de inicio</p>
          </div>
          <button
            onClick={dismiss}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors shrink-0"
            aria-label="Cerrar"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
        <button
          onClick={instalar}
          className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
        >
          <Download className="w-4 h-4" />
          Instalar ahora
        </button>
      </div>
    </div>
  );
}

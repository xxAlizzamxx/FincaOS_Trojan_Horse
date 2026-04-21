'use client';

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { X } from 'lucide-react';

interface Alerta {
  id: string;
  categoria_id: string;
  zona: string;
  mensaje: string;
  nivel?: 'medium' | 'high';
  created_at?: unknown;
}

export function AlertaGlobalBanner() {
  const { perfil } = useAuth();
  const [alertas, setAlertas] = useState<Alerta[]>([]);

  useEffect(() => {
    if (!perfil?.comunidad_id) return;

    console.log('[ALERT BANNER] Subscribing to alertas_globales for comunidad:', perfil.comunidad_id);

    const q = query(
      collection(db, 'alertas_globales'),
      where('activa', '==', true),
      where('comunidad_id', '==', perfil.comunidad_id),
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Alerta));
        console.log('[ALERT BANNER] Snapshot received, active alerts:', data.length);
        setAlertas(data);
      },
      (error) => {
        console.error('[ALERT SNAPSHOT ERROR]', error.code, error.message);
      },
    );

    return () => unsub();
  }, [perfil?.comunidad_id]);

  const dismiss = (id: string) => {
    console.log('[ALERT BANNER] Dismissing alert:', id);
    updateDoc(doc(db, 'alertas_globales', id), { activa: false }).catch((err) => {
      console.error('[ALERT BANNER] Dismiss failed:', err);
    });
  };

  if (alertas.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9990] flex flex-col gap-1 pointer-events-none">
      {alertas.map((a) => (
        <div
          key={a.id}
          className="pointer-events-auto flex items-start gap-3 bg-amber-50 border-b border-amber-300 px-4 py-3 shadow-sm"
        >
          <span className="text-amber-600 text-lg shrink-0">⚠️</span>
          <p className="flex-1 text-sm text-amber-900 leading-snug">{a.mensaje}</p>
          <button
            onClick={() => dismiss(a.id)}
            className="shrink-0 p-1 rounded hover:bg-amber-100 transition-colors"
            aria-label="Cerrar alerta"
          >
            <X className="w-4 h-4 text-amber-700" />
          </button>
        </div>
      ))}
    </div>
  );
}

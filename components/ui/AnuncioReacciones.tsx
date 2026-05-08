'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  query,
  setDoc,
  deleteDoc,
  doc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

const REACCIONES = ['👍', '❤️', '😄', '👏'] as const;
type Emoji = typeof REACCIONES[number];

interface Props {
  anuncioId: string;
}

export function AnuncioReacciones({ anuncioId }: Props) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<Emoji, number>>({
    '👍': 0,
    '❤️': 0,
    '😄': 0,
    '👏': 0,
  });
  const [miReaccion, setMiReaccion] = useState<Emoji | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'anuncios', anuncioId, 'reacciones'));
    const unsub = onSnapshot(q, snap => {
      const newCounts: Record<Emoji, number> = { '👍': 0, '❤️': 0, '😄': 0, '👏': 0 };
      let miEmoji: Emoji | null = null;
      snap.docs.forEach(d => {
        const emoji = d.data().emoji as Emoji;
        if (newCounts[emoji] !== undefined) newCounts[emoji]++;
        if (d.id === user?.uid) miEmoji = emoji;
      });
      setMiReaccion(miEmoji);
      setCounts(newCounts);
    });
    return () => unsub();
  }, [anuncioId, user?.uid]);

  async function toggleReaccion(emoji: Emoji) {
    if (!user?.uid) return;
    const ref = doc(db, 'anuncios', anuncioId, 'reacciones', user.uid);
    if (miReaccion === emoji) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { emoji, created_at: new Date().toISOString() });
    }
  }

  const totalReacciones = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalReacciones === 0 && !user) return null;

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {REACCIONES.map(emoji => {
        const count = counts[emoji];
        const active = miReaccion === emoji;
        if (count === 0 && !active) {
          return (
            <button
              key={emoji}
              onClick={() => toggleReaccion(emoji)}
              className="text-lg opacity-20 hover:opacity-60 transition-opacity"
            >
              {emoji}
            </button>
          );
        }
        return (
          <button
            key={emoji}
            onClick={() => toggleReaccion(emoji)}
            className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all',
              active
                ? 'bg-finca-peach/40 border-finca-coral/40 text-finca-coral font-medium'
                : 'bg-muted border-transparent text-muted-foreground hover:border-border',
            )}
          >
            <span>{emoji}</span>
            {count > 0 && <span>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

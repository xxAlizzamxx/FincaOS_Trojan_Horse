'use client';

import { useState } from 'react';
import { collection, getDocs, addDoc, doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CATEGORIAS = [
  { nombre: 'Ascensor', icono: '🛗' },
  { nombre: 'Fontanería', icono: '🚿' },
  { nombre: 'Electricidad', icono: '⚡' },
  { nombre: 'Zonas comunes', icono: '🏢' },
  { nombre: 'Jardín', icono: '🌿' },
  { nombre: 'Garaje', icono: '🅿️' },
  { nombre: 'Fachada', icono: '🏗️' },
  { nombre: 'Ruidos', icono: '🔊' },
  { nombre: 'Otro', icono: '📦' },
];

export default function SeedPage() {
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);

  function addLog(msg: string) {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }

  async function runSeed() {
    setRunning(true);
    setLog([]);

    try {
      // 1. Check if categorias already exist
      addLog('Checking categorias_incidencia...');
      const existing = await getDocs(collection(db, 'categorias_incidencia'));
      if (existing.size > 0) {
        addLog(`Already have ${existing.size} categorias. Skipping.`);
      } else {
        addLog('Creating 9 categorias_incidencia...');
        for (const cat of CATEGORIAS) {
          await addDoc(collection(db, 'categorias_incidencia'), {
            nombre: cat.nombre,
            icono: cat.icono,
            created_at: new Date().toISOString(),
          });
          addLog(`  Created: ${cat.icono} ${cat.nombre}`);
        }
        addLog('Categorias created successfully.');
      }

      // 2. Verify collections are accessible
      const collections = [
        'comunidades', 'perfiles', 'incidencias', 'comentarios',
        'incidencia_afectados', 'anuncios', 'documentos', 'votaciones',
        'opciones_votacion', 'respuestas_votacion', 'cuotas_vecinos',
        'mediaciones', 'consultas_normativas',
      ];

      addLog('');
      addLog('Verifying Firestore collections...');
      for (const col of collections) {
        try {
          const snap = await getDocs(collection(db, col));
          addLog(`  ${col}: ${snap.size} documents`);
        } catch (err: any) {
          addLog(`  ${col}: ERROR - ${err.message}`);
        }
      }

      addLog('');
      addLog('SEED COMPLETED SUCCESSFULLY');
      setDone(true);
    } catch (err: any) {
      addLog(`ERROR: ${err.message}`);
      addLog('Make sure Firestore is enabled in Firebase Console:');
      addLog('https://console.firebase.google.com/project/fincaos-e0bce/firestore');
    }

    setRunning(false);
  }

  return (
    <div className="min-h-screen bg-background p-8 max-w-2xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle>FincaOS — Database Seed</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This will create the initial collections and seed data in Firestore.
            Make sure Firestore is enabled in your Firebase project first.
          </p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm font-medium text-yellow-800">Before running:</p>
            <ol className="text-xs text-yellow-700 mt-1 space-y-1 list-decimal list-inside">
              <li>Go to <a href="https://console.firebase.google.com/project/fincaos-e0bce/firestore" target="_blank" className="underline">Firebase Console → Firestore</a></li>
              <li>Click "Create database"</li>
              <li>Select "Start in test mode" (we'll update rules later)</li>
              <li>Choose region: europe-west1 (Belgium) for Spain</li>
              <li>Then come back here and click Seed</li>
            </ol>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-medium text-blue-800">Also enable Authentication:</p>
            <ol className="text-xs text-blue-700 mt-1 space-y-1 list-decimal list-inside">
              <li>Go to <a href="https://console.firebase.google.com/project/fincaos-e0bce/authentication" target="_blank" className="underline">Firebase Console → Authentication</a></li>
              <li>Click "Get started"</li>
              <li>Enable "Email/Password" sign-in provider</li>
            </ol>
          </div>

          <Button
            onClick={runSeed}
            disabled={running || done}
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white"
          >
            {running ? 'Running...' : done ? 'Seed Complete' : 'Run Seed'}
          </Button>

          {log.length > 0 && (
            <div className="bg-finca-dark rounded-lg p-4 font-mono text-xs text-green-400 max-h-96 overflow-y-auto">
              {log.map((line, i) => (
                <div key={i} className={line.includes('ERROR') ? 'text-red-400' : line.includes('SUCCESS') ? 'text-green-300 font-bold' : ''}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {done && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-sm font-medium text-green-800">Database ready. You can now register at <a href="/registro" className="underline">/registro</a></p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

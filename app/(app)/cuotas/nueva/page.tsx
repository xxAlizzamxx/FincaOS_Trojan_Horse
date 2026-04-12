'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Wallet, Loader2, Info } from 'lucide-react';
import { db } from '@/lib/firebase/client';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { useAuthGuard } from '@/hooks/useAuthGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export default function NuevaCuotaPage() {
  const router = useRouter();
  const { perfil, loading: authLoading } = useAuthGuard(
    ['admin', 'presidente'],
    '/cuotas',
  );

  const [nombre, setNombre] = useState('');
  const [monto, setMonto] = useState('');
  const [fechaLimite, setFechaLimite] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ─── Minimum date: today ─── */
  const hoy = new Date().toISOString().split('T')[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!perfil?.comunidad_id) return;

    setError(null);

    const montoNum = parseFloat(monto.replace(',', '.'));
    if (!nombre.trim()) return setError('El nombre de la cuota es obligatorio.');
    if (isNaN(montoNum) || montoNum <= 0) return setError('El importe debe ser mayor que 0.');
    if (!fechaLimite) return setError('La fecha límite es obligatoria.');

    setSaving(true);
    try {
      const cid = perfil.comunidad_id;

      /* 1. Create the cuota document */
      const cuotaRef = await addDoc(collection(db, 'cuotas'), {
        comunidad_id: cid,
        nombre: nombre.trim(),
        monto: montoNum,
        fecha_limite: new Date(fechaLimite).toISOString(),
        created_at: new Date().toISOString(),
      });

      /* 2. Get all community members */
      const perfilesSnap = await getDocs(
        query(collection(db, 'perfiles'), where('comunidad_id', '==', cid)),
      );

      /* 3. Batch-create one pago doc per member */
      const batch = writeBatch(db);
      perfilesSnap.docs.forEach((perfilDoc) => {
        const pagoRef = doc(db, 'cuotas', cuotaRef.id, 'pagos', perfilDoc.id);
        batch.set(pagoRef, {
          usuario_id: perfilDoc.id,
          estado: 'pendiente',
          fecha_pago: null,
        });
      });
      await batch.commit();

      router.push('/cuotas');
    } catch (err) {
      console.error('Error creating cuota:', err);
      setError('Error al crear la cuota. Inténtalo de nuevo.');
      setSaving(false);
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div>
          <h1 className="text-xl font-semibold text-finca-dark">Nueva cuota</h1>
          <p className="text-xs text-muted-foreground">
            Se asignará automáticamente a todos los vecinos
          </p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-5">

            {/* Nombre */}
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre de la cuota</Label>
              <Input
                id="nombre"
                placeholder="Ej: Cuota ordinaria marzo 2026"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                maxLength={80}
                required
              />
            </div>

            {/* Monto */}
            <div className="space-y-1.5">
              <Label htmlFor="monto">Importe (€)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  €
                </span>
                <Input
                  id="monto"
                  type="number"
                  placeholder="0,00"
                  min="0.01"
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  className="pl-7"
                  required
                />
              </div>
            </div>

            {/* Fecha límite */}
            <div className="space-y-1.5">
              <Label htmlFor="fecha">Fecha límite de pago</Label>
              <Input
                id="fecha"
                type="date"
                value={fechaLimite}
                onChange={(e) => setFechaLimite(e.target.value)}
                min={hoy}
                required
              />
            </div>
          </CardContent>
        </Card>

        {/* Info banner */}
        <div className="flex gap-2.5 p-3 rounded-xl bg-blue-50">
          <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 leading-relaxed">
            Al crear la cuota se generará automáticamente un registro de{' '}
            <strong>pago pendiente</strong> para cada vecino de la comunidad.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-500 text-center px-2">{error}</p>
        )}

        {/* Submit */}
        <Button
          type="submit"
          disabled={saving}
          className={cn(
            'w-full h-12 text-base font-medium rounded-xl text-white',
            'bg-finca-coral hover:bg-finca-coral/90',
          )}
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creando cuota…
            </>
          ) : (
            <>
              <Wallet className="w-4 h-4 mr-2" />
              Crear cuota
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

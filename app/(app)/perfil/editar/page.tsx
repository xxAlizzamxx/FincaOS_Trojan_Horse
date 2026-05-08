'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, Save } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { updatePerfilPrivado } from '@/lib/firebase/createPerfil';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

interface FormData {
  nombre_completo: string;
  telefono: string;
  torre: string;
  piso: string;
  puerta: string;
}

export default function EditarPerfilPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [form, setForm] = useState<FormData>({
    nombre_completo: '',
    telefono: '',
    torre: '',
    piso: '',
    puerta: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [customPhoto, setCustomPhoto] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user) fetchPerfil();
  }, [user]);

  async function fetchPerfil() {
    // Cargar datos públicos y privados en paralelo
    const [publicSnap, privadoSnap] = await Promise.all([
      getDoc(doc(db, 'perfiles',         user!.uid)),
      getDoc(doc(db, 'perfiles_privados', user!.uid)),
    ]);

    const publicData  = publicSnap.exists()  ? publicSnap.data()  : {};
    const privadoData = privadoSnap.exists() ? privadoSnap.data() : {};

    setForm({
      nombre_completo: publicData.nombre_completo  || '',
      // Teléfono: fuente de verdad es perfiles_privados.
      // Fallback a perfiles para usuarios pre-migración.
      telefono: privadoData.telefono ?? publicData.telefono ?? '',
      torre:    publicData.torre  || '',
      piso:     publicData.piso   || '',
      puerta:   publicData.puerta || '',
    });

    // Load custom avatar if present
    if (publicData.avatar_url) {
      setCustomPhoto(publicData.avatar_url);
    }

    setLoading(false);
  }

  function handleChange(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = await user.getIdToken();
      const res = await fetch('/api/upload-photo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error('Error al subir la foto');
      const { url } = await res.json();

      await updateDoc(doc(db, 'perfiles', user.uid), { avatar_url: url });
      setCustomPhoto(url);
      toast.success('Foto de perfil actualizada');
    } catch (err: any) {
      toast.error(err.message || 'Error al subir la foto');
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!form.nombre_completo.trim()) {
      toast.error('El nombre no puede estar vacío');
      return;
    }
    setSaving(true);
    try {
      // numero_piso combinado para compatibilidad con el resto de la app
      const numeroPiso =
        [form.torre.trim(), form.piso.trim(), form.puerta.trim()]
          .filter(Boolean)
          .join(' · ') || null;

      // ── Escribir en paralelo: datos públicos + datos privados ───────────
      await Promise.all([
        // Perfil PÚBLICO — sin teléfono
        updateDoc(doc(db, 'perfiles', user.uid), {
          nombre_completo: form.nombre_completo.trim(),
          torre:           form.torre.trim()  || null,
          piso:            form.piso.trim()   || null,
          puerta:          form.puerta.trim() || null,
          numero_piso:     numeroPiso,
          updated_at:      new Date().toISOString(),
        }),
        // Perfil PRIVADO — teléfono va aquí (nunca al perfil público)
        updatePerfilPrivado(user.uid, {
          telefono: form.telefono.trim() || null,
        }),
      ]);

      toast.success('Perfil actualizado correctamente');
      router.back();
    } catch {
      toast.error('Error al guardar los cambios');
    } finally {
      setSaving(false);
    }
  }

  const iniciales =
    form.nombre_completo
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('')
      .toUpperCase() || '?';

  const fotoGoogle = user?.photoURL;

  if (authLoading || loading) {
    return (
      <div className="px-4 py-5 space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="w-9 h-9 shrink-0" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-semibold text-finca-dark">Editar perfil</h1>
      </div>

      {/* Avatar — foto personalizada, Google o iniciales */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-finca-peach/40 flex items-center justify-center shrink-0 overflow-hidden">
              {customPhoto ? (
                <img
                  src={customPhoto}
                  alt="Foto de perfil"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : fotoGoogle ? (
                <img
                  src={fotoGoogle}
                  alt="Foto de perfil"
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span className="text-xl font-bold text-finca-coral">{iniciales}</span>
              )}
            </div>
            {/* Upload button overlay */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-finca-coral text-white flex items-center justify-center shadow-sm hover:bg-finca-coral/90 transition-colors"
            >
              {uploadingPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-finca-dark truncate">{form.nombre_completo || 'Sin nombre'}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {customPhoto ? 'Foto personalizada' : fotoGoogle ? 'Foto de Google' : 'Sin foto vinculada'}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Formulario */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-4">

            {/* Nombre completo */}
            <div className="space-y-1.5">
              <Label htmlFor="nombre_completo">
                Nombre completo <span className="text-finca-coral">*</span>
              </Label>
              <Input
                id="nombre_completo"
                placeholder="Ej. Ana García López"
                value={form.nombre_completo}
                onChange={(e) => handleChange('nombre_completo', e.target.value)}
                required
              />
            </div>

            {/* Teléfono */}
            <div className="space-y-1.5">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input
                id="telefono"
                type="tel"
                placeholder="Ej. 612 345 678"
                value={form.telefono}
                onChange={(e) => handleChange('telefono', e.target.value)}
              />
            </div>

            {/* Torre */}
            <div className="space-y-1.5">
              <Label htmlFor="torre">Torre</Label>
              <Input
                id="torre"
                placeholder="Ej. A"
                value={form.torre}
                onChange={(e) => handleChange('torre', e.target.value)}
              />
            </div>

            {/* Piso + Apartamento (puerta) en dos columnas */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="piso">Piso</Label>
                <Input
                  id="piso"
                  placeholder="Ej. 3º"
                  value={form.piso}
                  onChange={(e) => handleChange('piso', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="puerta">Apartamento</Label>
                <Input
                  id="puerta"
                  placeholder="Ej. B"
                  value={form.puerta}
                  onChange={(e) => handleChange('puerta', e.target.value)}
                />
              </div>
            </div>

          </CardContent>
        </Card>

        <Button
          type="submit"
          className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-medium shadow-sm shadow-finca-coral/20"
          disabled={saving}
        >
          {saving ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <Save className="w-4 h-4 mr-2" />
              Guardar cambios
            </>
          )}
        </Button>
      </form>
    </div>
  );
}

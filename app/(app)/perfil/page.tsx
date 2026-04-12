'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, User, Building2, Bell, Shield, ChevronRight, Copy, Share2, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { db } from '@/lib/firebase/client';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

export default function PerfilPage() {
  const { perfil, signOut, user } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [comunidadNombre, setComunidadNombre] = useState('');
  const [savingName, setSavingName] = useState(false);

  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  const rolLabel: Record<string, string> = { vecino: 'Vecino', presidente: 'Presidente', admin: 'Administrador' };
  const rolColor: Record<string, string> = {
    vecino: 'bg-gray-100 text-gray-600 border-gray-200',
    presidente: 'bg-finca-peach/50 text-finca-coral border-finca-peach',
    admin: 'bg-finca-coral text-white border-finca-coral',
  };

  async function handleSignOut() {
    setLoggingOut(true);
    await signOut();
    router.replace('/login');
  }

  async function compartirLink() {
    if (!perfil?.comunidad_id) return;
    const snap = await getDoc(doc(db, 'comunidades', perfil.comunidad_id));
    const codigo = snap.data()?.codigo;
    if (!codigo) return;
    const url = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/invite/${codigo}`;
    if (navigator.share) {
      navigator.share({ title: 'Únete a mi comunidad en FincaOS', text: 'Únete a nuestra comunidad con este enlace:', url });
    } else {
      navigator.clipboard.writeText(url);
      toast.success('Link de invitación copiado');
    }
  }

  function startEditingName() {
    setComunidadNombre((perfil?.comunidad as any)?.nombre || '');
    setEditingName(true);
  }

  async function saveNombre() {
    if (!comunidadNombre.trim() || !perfil?.comunidad_id) return;
    setSavingName(true);
    await updateDoc(doc(db, 'comunidades', perfil.comunidad_id), {
      nombre: comunidadNombre.trim(),
    });
    toast.success('Nombre actualizado');
    setSavingName(false);
    setEditingName(false);
    window.location.reload();
  }

  const iniciales = perfil?.nombre_completo
    ?.split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('') || '?';

  const fotoGoogle = user?.photoURL;
  const torre    = (perfil as any)?.torre  || null;
  const piso     = (perfil as any)?.piso   || null;
  const apartamento = (perfil as any)?.puerta || null;

  return (
    <div className="px-4 py-5 space-y-5">
      <h1 className="text-2xl font-semibold text-finca-dark">Mi perfil</h1>

      <Card className="border-0 shadow-sm overflow-hidden">
        {/* Banner: avatar + nombre en blanco lado a lado */}
        <div className="bg-gradient-to-r from-finca-coral to-finca-salmon px-4 py-5 flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-white/20 border-2 border-white/50 flex items-center justify-center overflow-hidden shrink-0 shadow-md">
            {fotoGoogle ? (
              <img
                src={fotoGoogle}
                alt="Foto de perfil"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <span className="text-2xl font-bold text-white">{iniciales}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white font-bold text-xl truncate">
              {perfil?.nombre_completo || 'Sin nombre'}
            </p>
            <p className="text-white/80 text-xs truncate mt-0.5">{user?.email}</p>
          </div>
          <Badge className={cn('text-[10px] border shrink-0 bg-white/20 text-white border-white/40')}>
            {rolLabel[perfil?.rol || 'vecino']}
          </Badge>
        </div>

        <CardContent className="px-4 pb-4 pt-3">

          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="font-semibold text-finca-dark text-sm">{torre || '—'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Torre</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="font-semibold text-finca-dark text-sm">{piso || '—'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Piso</p>
            </div>
            <div className="bg-muted/50 rounded-xl p-3 text-center">
              <p className="font-semibold text-finca-dark text-sm">{apartamento || '—'}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Apartamento</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {(perfil?.comunidad as any)?.nombre && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-finca-coral" />
                <p className="font-medium text-sm text-finca-dark">Mi comunidad</p>
              </div>
              {esAdmin && !editingName && (
                <button onClick={startEditingName} className="text-muted-foreground hover:text-finca-coral transition-colors p-1">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {editingName ? (
              <div className="flex gap-2">
                <Input
                  value={comunidadNombre}
                  onChange={(e) => setComunidadNombre(e.target.value)}
                  className="h-9 text-sm"
                  autoFocus
                />
                <Button size="icon" className="h-9 w-9 bg-finca-coral hover:bg-finca-coral/90 text-white shrink-0" onClick={saveNombre} disabled={savingName}>
                  <Check className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="outline" className="h-9 w-9 shrink-0" onClick={() => setEditingName(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{(perfil?.comunidad as any)?.nombre}</p>
            )}
            {(perfil?.comunidad as any)?.direccion && (
              <p className="text-xs text-muted-foreground">{(perfil?.comunidad as any)?.direccion}</p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white w-full"
              onClick={compartirLink}
            >
              <Share2 className="w-3.5 h-3.5 mr-2" />
              Compartir link de invitación
            </Button>
          </CardContent>
        </Card>
      )}

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {[
            { icon: User, label: 'Editar perfil', sub: 'Nombre, teléfono, piso', href: '/perfil/editar' },
            { icon: Bell, label: 'Notificaciones', sub: 'Gestionar alertas', href: '/perfil/notificaciones' },
            { icon: Shield, label: 'Privacidad', sub: 'Datos y permisos', href: '/perfil/privacidad' },
          ].map((item, idx) => (
            <div key={item.label}>
              {idx > 0 && <Separator />}
              <button
                className="w-full flex items-center gap-3 p-4 hover:bg-muted/30 transition-colors text-left"
                onClick={() => router.push(item.href)}
              >
                <div className="w-9 h-9 rounded-xl bg-finca-peach/40 flex items-center justify-center shrink-0">
                  <item.icon className="w-4.5 h-4.5 text-finca-coral" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-finca-dark">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.sub}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            </div>
          ))}
        </CardContent>
      </Card>

      {perfil?.rol === 'admin' && (
        <Button
          variant="outline"
          className="w-full border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white"
          onClick={() => router.push('/admin')}
        >
          <Shield className="w-4 h-4 mr-2" />
          Panel de administrador
        </Button>
      )}

      <Button
        variant="outline"
        className="w-full border-red-200 text-red-500 hover:bg-red-50"
        onClick={handleSignOut}
        disabled={loggingOut}
      >
        <LogOut className="w-4 h-4 mr-2" />
        {loggingOut ? 'Cerrando sesión...' : 'Cerrar sesión'}
      </Button>

      <p className="text-center text-xs text-muted-foreground pb-2">
        FincaOS v2.0 — Technology · Community · Governance
      </p>
    </div>
  );
}

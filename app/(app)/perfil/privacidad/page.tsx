'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Mail, Shield, User, Hash, Building2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

function InfoRow({
  icon: Icon,
  label,
  value,
  copiable = false,
  mono = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  copiable?: boolean;
  mono?: boolean;
}) {
  function copiar() {
    navigator.clipboard.writeText(value);
    toast.success('Copiado al portapapeles');
  }

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="w-8 h-8 rounded-lg bg-finca-peach/40 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-finca-coral" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={cn('text-sm text-finca-dark truncate', mono && 'font-mono text-xs')}>
          {value}
        </p>
      </div>
      {copiable && (
        <button
          onClick={copiar}
          className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-finca-coral"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export default function PrivacidadPage() {
  const { user, perfil, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  const rolLabel: Record<string, string> = {
    vecino: 'Vecino',
    presidente: 'Presidente',
    admin: 'Administrador',
  };
  const rolColor: Record<string, string> = {
    vecino: 'bg-gray-100 text-gray-600 border-gray-200',
    presidente: 'bg-finca-peach/50 text-finca-coral border-finca-peach',
    admin: 'bg-finca-coral text-white border-finca-coral',
  };

  const creadoEn = perfil?.created_at
    ? new Date(perfil.created_at).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '—';

  if (authLoading) {
    return (
      <div className="px-4 py-5 space-y-5">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 shrink-0"
          onClick={() => router.back()}
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold text-finca-dark">Privacidad</h1>
          <p className="text-xs text-muted-foreground">Solo lectura — información de tu cuenta</p>
        </div>
      </div>

      {/* Datos de cuenta */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0 px-4 pt-4">
          <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
            <User className="w-4 h-4 text-finca-coral" />
            Datos de cuenta
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-2 divide-y divide-border">
          <InfoRow
            icon={Mail}
            label="Correo electrónico"
            value={user?.email || '—'}
            copiable
          />
          <InfoRow
            icon={Hash}
            label="ID de usuario (UID)"
            value={user?.uid || '—'}
            copiable
            mono
          />
          <InfoRow
            icon={User}
            label="Nombre completo"
            value={perfil?.nombre_completo || '—'}
          />
          <InfoRow
            icon={Building2}
            label="Piso / Puerta"
            value={perfil?.numero_piso || 'No especificado'}
          />
        </CardContent>
      </Card>

      {/* Rol y permisos */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-0 px-4 pt-4">
          <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
            <Shield className="w-4 h-4 text-finca-coral" />
            Rol y permisos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Rol actual</p>
            <Badge
              className={cn(
                'text-xs border',
                rolColor[perfil?.rol || 'vecino']
              )}
            >
              {rolLabel[perfil?.rol || 'vecino']}
            </Badge>
          </div>

          <Separator />

          <div className="space-y-2">
            {[
              {
                label: 'Ver incidencias',
                allowed: true,
              },
              {
                label: 'Crear incidencias',
                allowed: true,
              },
              {
                label: 'Gestionar anuncios',
                allowed: ['admin', 'presidente'].includes(perfil?.rol || ''),
              },
              {
                label: 'Panel de administración',
                allowed: ['admin', 'presidente'].includes(perfil?.rol || ''),
              },
              {
                label: 'Gestionar vecinos',
                allowed: perfil?.rol === 'admin',
              },
            ].map((permiso) => (
              <div key={permiso.label} className="flex items-center justify-between py-1">
                <p className="text-sm text-finca-dark">{permiso.label}</p>
                <Badge
                  className={cn(
                    'text-[10px] border-0',
                    permiso.allowed
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-400'
                  )}
                >
                  {permiso.allowed ? 'Permitido' : 'Sin acceso'}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Comunidad */}
      {perfil?.comunidad && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-0 px-4 pt-4">
            <CardTitle className="text-sm font-semibold text-finca-dark flex items-center gap-2">
              <Building2 className="w-4 h-4 text-finca-coral" />
              Comunidad vinculada
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 divide-y divide-border">
            <InfoRow
              icon={Building2}
              label="Nombre de la comunidad"
              value={(perfil.comunidad as any).nombre || '—'}
            />
            <InfoRow
              icon={Hash}
              label="Código de comunidad"
              value={(perfil.comunidad as any).codigo || '—'}
              copiable
              mono
            />
          </CardContent>
        </Card>
      )}

      {/* Info legal */}
      <Card className="border-0 shadow-sm bg-muted/30">
        <CardContent className="p-4 flex gap-3">
          <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-finca-dark">Política de datos</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tus datos se almacenan de forma segura en Firebase y solo son
              accesibles por los miembros de tu comunidad y los administradores.
              Cuenta creada el {creadoEn}.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

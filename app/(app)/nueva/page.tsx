'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleAlert as AlertCircle, Scale, BookOpen, Megaphone, ChevronRight, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const acciones = [
  {
    icon: AlertCircle,
    titulo: 'Reportar incidencia',
    descripcion: 'Averías, daños o problemas en zonas comunes o tu vivienda',
    href: '/nueva/incidencia',
    color: 'bg-red-50 text-red-500',
    border: 'hover:border-red-200',
  },
  {
    icon: Scale,
    titulo: 'Iniciar mediación',
    descripcion: 'Conflictos vecinales: ruido, parking, mascotas u obras',
    href: '/nueva/mediacion',
    color: 'bg-finca-peach/50 text-finca-coral',
    border: 'hover:border-finca-salmon',
  },
  {
    icon: BookOpen,
    titulo: 'Consulta normativa',
    descripcion: 'Pregunta sobre la LPH, estatutos o normativa municipal',
    href: '/nueva/normativa',
    color: 'bg-blue-50 text-blue-500',
    border: 'hover:border-blue-200',
  },
  {
    icon: Megaphone,
    titulo: 'Publicar en el tablón',
    descripcion: 'Comparte un anuncio o aviso con toda la comunidad',
    href: '/nueva/anuncio',
    color: 'bg-green-50 text-green-500',
    border: 'hover:border-green-200',
    adminOnly: true,
  },
];

export default function NuevaPage() {
  const router = useRouter();
  const { perfil } = useAuth();
  const esAdmin = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  return (
    <div className="px-4 py-5">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-finca-dark">¿Qué necesitas?</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Selecciona una opción para continuar</p>
        </div>
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors"
        >
          <X className="w-4 h-4 text-muted-foreground" />
        </button>
      </div>

      <div className="space-y-3">
        {acciones.map((accion) => {
          if (accion.adminOnly && !esAdmin) return null;
          const Icon = accion.icon;
          return (
            <button
              key={accion.href}
              onClick={() => router.push(accion.href)}
              className="w-full text-left"
            >
              <Card className={cn('border transition-all active:scale-[0.99] cursor-pointer', accion.border)}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center shrink-0', accion.color)}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-finca-dark">{accion.titulo}</p>
                    <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{accion.descripcion}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            </button>
          );
        })}
      </div>

      <div className="mt-6 p-4 bg-finca-peach/20 rounded-2xl">
        <p className="text-xs text-finca-dark font-medium mb-0.5">Protegido por FincaOS</p>
        <p className="text-xs text-muted-foreground">Toda la información es confidencial y solo visible para tu comunidad</p>
      </div>
    </div>
  );
}

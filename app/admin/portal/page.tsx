'use client';

import { UserCheck, Home, KeyRound } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function PortalPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-100 to-indigo-50 flex items-center justify-center mx-auto">
          <UserCheck className="w-10 h-10 text-indigo-600" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Portal Propietario / Inquilino</h1>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            Proximamente podras distinguir si el vecino es propietario o arrendatario, con permisos y vistas adaptadas para cada perfil.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 max-w-sm mx-auto">
          <Card className="border-dashed border-2 border-emerald-200 bg-emerald-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <Home className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-medium text-emerald-700">Propietario</p>
              <p className="text-[10px] text-muted-foreground">Acceso completo, votaciones, finanzas</p>
            </CardContent>
          </Card>
          <Card className="border-dashed border-2 border-blue-200 bg-blue-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <KeyRound className="w-8 h-8 text-blue-500 mx-auto" />
              <p className="text-xs font-medium text-blue-700">Inquilino</p>
              <p className="text-[10px] text-muted-foreground">Incidencias, porteria, comunidad</p>
            </CardContent>
          </Card>
        </div>

        <div className="inline-flex items-center gap-2 bg-finca-peach/30 text-finca-coral text-xs font-medium px-4 py-2 rounded-full">
          <span className="w-2 h-2 rounded-full bg-finca-coral animate-pulse" />
          En desarrollo
        </div>
      </div>
    </div>
  );
}

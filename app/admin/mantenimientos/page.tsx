'use client';

import { Wrench, Droplets, TreePine, ArrowUpDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function MantenimientosPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 flex items-center justify-center mx-auto">
          <Wrench className="w-10 h-10 text-amber-600" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Mantenimientos Preventivos</h1>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            Proximamente podras gestionar tus mantenimientos preventivos con agenda y recordatorios automaticos.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
          <Card className="border-dashed border-2 border-blue-200 bg-blue-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <Droplets className="w-8 h-8 text-blue-500 mx-auto" />
              <p className="text-xs font-medium text-blue-700">Piscina</p>
            </CardContent>
          </Card>
          <Card className="border-dashed border-2 border-green-200 bg-green-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <TreePine className="w-8 h-8 text-green-500 mx-auto" />
              <p className="text-xs font-medium text-green-700">Jardin</p>
            </CardContent>
          </Card>
          <Card className="border-dashed border-2 border-violet-200 bg-violet-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <ArrowUpDown className="w-8 h-8 text-violet-500 mx-auto" />
              <p className="text-xs font-medium text-violet-700">Ascensor</p>
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

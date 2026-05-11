'use client';

import { TrendingUp, BarChart3, Download, PieChart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export default function FinancieroPage() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="text-center space-y-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center mx-auto">
          <TrendingUp className="w-10 h-10 text-emerald-600" />
        </div>

        <div>
          <h1 className="text-2xl font-bold text-finca-dark">Panel Financiero</h1>
          <p className="text-muted-foreground mt-2 text-sm max-w-md mx-auto">
            Proximamente aqui podras ver el balance de ingresos vs gastos, graficas por mes, exportar contabilidad y mucho mas.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4">
          <Card className="border-dashed border-2 border-emerald-200 bg-emerald-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <BarChart3 className="w-8 h-8 text-emerald-500 mx-auto" />
              <p className="text-xs font-medium text-emerald-700">Ingresos vs Gastos</p>
            </CardContent>
          </Card>
          <Card className="border-dashed border-2 border-blue-200 bg-blue-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <PieChart className="w-8 h-8 text-blue-500 mx-auto" />
              <p className="text-xs font-medium text-blue-700">Graficas por mes</p>
            </CardContent>
          </Card>
          <Card className="border-dashed border-2 border-violet-200 bg-violet-50/30">
            <CardContent className="p-4 text-center space-y-2">
              <Download className="w-8 h-8 text-violet-500 mx-auto" />
              <p className="text-xs font-medium text-violet-700">Exportar contabilidad</p>
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

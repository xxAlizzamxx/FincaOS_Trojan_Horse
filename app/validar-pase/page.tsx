'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  collection, query, where, getDocs, updateDoc, doc, addDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  CheckCircle2, XCircle, Clock, Loader2, QrCode, ArrowLeft, UserCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';

interface PaseAcceso {
  id: string;
  comunidad_id: string;
  vecino_id: string;
  vecino_nombre: string;
  vecino_apartamento: string;
  visitante_nombre: string;
  tipo: string;
  motivo?: string;
  token: string;
  expira_at: string;
  uso_unico: boolean;
  max_usos: number;
  usos: number;
  estado: 'activo' | 'usado' | 'expirado' | 'cancelado';
  created_at: string;
}

const tiposLabel: Record<string, string> = {
  visitante:  'Visitante',
  familiar:   'Familiar',
  repartidor: 'Repartidor',
  tecnico:    'Técnico',
  proveedor:  'Proveedor',
};

function ValidarPaseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, perfil } = useAuth();
  const token = searchParams.get('t');

  const [pase, setPase] = useState<PaseAcceso | null>(null);
  const [loading, setLoading] = useState(true);
  const [validando, setValidando] = useState(false);
  const [validado, setValidado] = useState(false);

  const esVigilante = perfil?.rol === 'vigilante' || perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  useEffect(() => {
    if (!token) { setLoading(false); return; }
    const q = query(collection(db, 'pases_acceso'), where('token', '==', token));
    getDocs(q).then(snap => {
      if (!snap.empty) setPase({ id: snap.docs[0].id, ...snap.docs[0].data() } as PaseAcceso);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  const ahora = new Date();
  const expirado = pase ? new Date(pase.expira_at) < ahora : false;
  const agotado  = pase ? pase.usos >= pase.max_usos : false;
  const valido   = pase?.estado === 'activo' && !expirado && !agotado;

  async function validarPase() {
    if (!pase || !user || !perfil) return;
    setValidando(true);
    try {
      const nuevosUsos = pase.usos + 1;
      const nuevoEstado = (pase.uso_unico || nuevosUsos >= pase.max_usos) ? 'usado' : 'activo';

      await updateDoc(doc(db, 'pases_acceso', pase.id), {
        usos:    nuevosUsos,
        estado:  nuevoEstado,
        validado_at: new Date().toISOString(),
        validado_por: user.uid,
      });

      // Registrar acceso automáticamente
      await addDoc(collection(db, 'accesos'), {
        comunidad_id:        pase.comunidad_id,
        vigilante_id:        user.uid,
        visitante_nombre:    pase.visitante_nombre,
        tipo:                pase.tipo,
        vecino_id:           pase.vecino_id,
        vecino_nombre:       pase.vecino_nombre,
        apartamento_destino: pase.vecino_apartamento,
        motivo:              pase.motivo || null,
        estado:              'autorizado',
        hora_entrada:        new Date().toISOString(),
        hora_salida:         null,
        pase_id:             pase.id,
        created_at:          new Date().toISOString(),
      });

      setPase(p => p ? { ...p, usos: nuevosUsos, estado: nuevoEstado } : p);
      setValidado(true);
      toast.success('Pase validado — acceso registrado');
    } catch (err) {
      console.error('[ValidarPase]', err);
      toast.error('Error al validar el pase');
    } finally {
      setValidando(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-finca-coral" />
      </div>
    );
  }

  if (!token || !pase) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
          <XCircle className="w-8 h-8 text-red-500" />
        </div>
        <div>
          <p className="font-semibold text-finca-dark text-lg">Pase no encontrado</p>
          <p className="text-sm text-muted-foreground mt-1">El código QR no corresponde a ningún pase activo</p>
        </div>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="w-4 h-4 mr-2" />Volver
        </Button>
      </div>
    );
  }

  const estadoColor = validado || pase.estado === 'usado'
    ? 'bg-green-100 text-green-700'
    : !valido
    ? 'bg-red-100 text-red-700'
    : 'bg-emerald-100 text-emerald-700';

  const estadoLabel = validado
    ? 'Validado'
    : pase.estado === 'cancelado'
    ? 'Cancelado'
    : expirado
    ? 'Expirado'
    : agotado || pase.estado === 'usado'
    ? 'Usado'
    : 'Activo';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm space-y-4">

        {/* Header */}
        <div className="text-center space-y-2">
          <div className={cn('w-16 h-16 rounded-full flex items-center justify-center mx-auto', valido ? 'bg-emerald-100' : 'bg-red-100')}>
            <QrCode className={cn('w-8 h-8', valido ? 'text-emerald-600' : 'text-red-500')} />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pase de acceso</p>
          <Badge className={cn('text-sm px-3 py-1', estadoColor)}>
            {estadoLabel}
          </Badge>
        </div>

        {/* Detalles del pase */}
        <Card className="border-0 shadow-md">
          <CardContent className="p-4 space-y-3">
            <div className="space-y-2.5">
              <Row label="Visitante" value={pase.visitante_nombre} highlight />
              <Row label="Tipo"      value={tiposLabel[pase.tipo] ?? pase.tipo} />
              <Row label="Para"      value={pase.vecino_nombre} />
              <Row label="Apartamento" value={pase.vecino_apartamento} />
              {pase.motivo && <Row label="Motivo" value={pase.motivo} />}
              <Row
                label="Expira"
                value={format(new Date(pase.expira_at), "dd MMM yyyy 'a las' HH:mm", { locale: es })}
                warning={expirado}
              />
              <Row label="Usos" value={`${pase.usos} / ${pase.max_usos}`} />
            </div>
          </CardContent>
        </Card>

        {/* Acción */}
        {esVigilante && !validado && valido && (
          <Button
            className="w-full bg-finca-coral hover:bg-finca-coral/90 text-white h-12 text-base font-semibold"
            onClick={validarPase}
            disabled={validando}
          >
            {validando
              ? <Loader2 className="w-5 h-5 animate-spin mr-2" />
              : <UserCheck className="w-5 h-5 mr-2" />
            }
            Validar y registrar entrada
          </Button>
        )}

        {(validado || pase.estado === 'usado') && (
          <div className="flex items-center justify-center gap-2 text-green-600 font-medium py-2">
            <CheckCircle2 className="w-5 h-5" />
            Acceso registrado correctamente
          </div>
        )}

        {!valido && pase.estado !== 'usado' && !validado && (
          <div className="flex items-center justify-center gap-2 text-red-500 font-medium py-2">
            <XCircle className="w-5 h-5" />
            {expirado ? 'Este pase ha expirado' : 'Este pase no es válido'}
          </div>
        )}

        <button onClick={() => router.back()} className="w-full text-sm text-muted-foreground hover:text-finca-dark text-center py-2 transition-colors">
          ← Volver
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, highlight, warning }: { label: string; value: string; highlight?: boolean; warning?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-sm text-right', highlight ? 'font-semibold text-finca-dark' : warning ? 'text-red-500 font-medium' : 'text-finca-dark dark:text-white')}>
        {value}
      </span>
    </div>
  );
}

export default function ValidarPasePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-finca-coral" /></div>}>
      <ValidarPaseContent />
    </Suspense>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Upload, FileText, FileSpreadsheet, File,
  Download, Loader2, X, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  collection, query, where, orderBy, getDocs,
  addDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import {
  subirDocumento, inferirTipo, EXTENSIONES_ACEPTADAS,
} from '@/lib/firebase/storage-docs';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import type { Documento, TipoDocumento } from '@/types/database';

/* ─── Configuración visual por tipo ─── */
const TIPO_CONFIG: Record<TipoDocumento, {
  label: string;
  icon: React.ElementType;
  bg: string;
  text: string;
  badge: string;
}> = {
  pdf: {
    label: 'PDF',
    icon: FileText,
    bg: 'bg-red-50',
    text: 'text-red-500',
    badge: 'bg-red-100 text-red-700',
  },
  word: {
    label: 'Word',
    icon: File,
    bg: 'bg-blue-50',
    text: 'text-blue-500',
    badge: 'bg-blue-100 text-blue-700',
  },
  excel: {
    label: 'Excel',
    icon: FileSpreadsheet,
    bg: 'bg-green-50',
    text: 'text-green-500',
    badge: 'bg-green-100 text-green-700',
  },
};

const TIPO_CONFIG_FALLBACK = {
  label: 'Doc',
  icon: FileText,
  bg: 'bg-gray-50',
  text: 'text-gray-500',
  badge: 'bg-gray-100 text-gray-600',
};

function tipoConfig(tipo: string | undefined) {
  return TIPO_CONFIG[tipo as TipoDocumento] ?? TIPO_CONFIG_FALLBACK;
}

/* ─── Componente ─── */
export default function DocsPage() {
  const router = useRouter();
  const { perfil } = useAuth();

  const puedeSubir = perfil?.rol === 'admin' || perfil?.rol === 'presidente';

  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [loading, setLoading] = useState(true);

  /* Sheet de subida */
  const [sheetOpen, setSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);
  const [nombrePersonalizado, setNombrePersonalizado] = useState('');
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState(0);

  useEffect(() => {
    if (perfil?.comunidad_id) fetchDocumentos();
  }, [perfil?.comunidad_id]);

  async function fetchDocumentos() {
    setLoading(true);
    try {
      const q = query(
        collection(db, 'documentos'),
        where('comunidad_id', '==', perfil!.comunidad_id),
        orderBy('created_at', 'desc')
      );
      const snap = await getDocs(q);
      setDocumentos(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Documento)));
    } catch {
      toast.error('Error al cargar los documentos');
    } finally {
      setLoading(false);
    }
  }

  /* ── Selección de archivo ── */
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setErrorArchivo(null);
    setArchivoSeleccionado(null);

    if (!file) return;

    const tipo = inferirTipo(file);
    if (!tipo) {
      setErrorArchivo('Formato no permitido. Usa PDF, Word o Excel.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setArchivoSeleccionado(file);
    if (!nombrePersonalizado.trim()) {
      // Autocompletar nombre sin extensión
      setNombrePersonalizado(file.name.replace(/\.[^.]+$/, ''));
    }
  }

  function resetSheet() {
    setArchivoSeleccionado(null);
    setNombrePersonalizado('');
    setErrorArchivo(null);
    setProgreso(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /* ── Subida ── */
  async function handleSubir() {
    if (!archivoSeleccionado || !perfil?.comunidad_id) return;
    const nombre = nombrePersonalizado.trim() || archivoSeleccionado.name;

    setSubiendo(true);
    setProgreso(0);
    try {
      const { url, storagePath, tipo } = await subirDocumento(
        archivoSeleccionado,
        perfil.comunidad_id,
        setProgreso
      );

      await addDoc(collection(db, 'documentos'), {
        comunidad_id: perfil.comunidad_id,
        nombre,
        url,
        storage_path: storagePath,
        tipo,
        tipo_mime: archivoSeleccionado.type,
        subido_por: perfil.id,
        created_by: perfil.id,
        descripcion: null,
        created_at: new Date().toISOString(),
      });

      toast.success('Documento subido correctamente');
      setSheetOpen(false);
      resetSheet();
      fetchDocumentos();
    } catch (err: any) {
      toast.error(err.message ?? 'Error al subir el documento');
    } finally {
      setSubiendo(false);
    }
  }

  /* ── Descarga ── */
  function descargar(doc: Documento) {
    if (!doc.url) { toast.error('URL no disponible'); return; }
    window.open(doc.url, '_blank', 'noopener,noreferrer');
  }

  /* ── Loading skeleton ── */
  if (loading) {
    return (
      <div className="px-4 py-5 space-y-4">
        <Skeleton className="h-8 w-36" />
        {[1, 2, 3].map((i) => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-8 w-20 rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 space-y-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="icon"
            className="w-8 h-8 -ml-1"
            onClick={() => router.back()}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-finca-dark">Documentos</h1>
            {documentos.length > 0 && (
              <p className="text-xs text-muted-foreground">{documentos.length} archivos</p>
            )}
          </div>
        </div>
        {puedeSubir && (
          <Button
            size="sm"
            className="bg-finca-coral hover:bg-finca-coral/90 text-white"
            onClick={() => { resetSheet(); setSheetOpen(true); }}
          >
            <Upload className="w-4 h-4 mr-1.5" />
            Subir
          </Button>
        )}
      </div>

      {/* ── Lista vacía ── */}
      {documentos.length === 0 && (
        <div className="py-16 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <FileText className="w-7 h-7 text-muted-foreground/50" />
          </div>
          <p className="font-medium text-finca-dark">Sin documentos</p>
          <p className="text-sm text-muted-foreground">
            {puedeSubir
              ? 'Sube el primer documento de tu comunidad'
              : 'Tu administrador subirá los documentos aquí'}
          </p>
          {puedeSubir && (
            <Button
              className="bg-finca-coral hover:bg-finca-coral/90 text-white"
              onClick={() => { resetSheet(); setSheetOpen(true); }}
            >
              <Upload className="w-4 h-4 mr-1.5" />
              Subir documento
            </Button>
          )}
        </div>
      )}

      {/* ── Lista de documentos ── */}
      <div className="space-y-2">
        {documentos.map((documento) => {
          const cfg = tipoConfig(documento.tipo);
          const Icon = cfg.icon;
          return (
            <Card key={documento.id} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                {/* Icono tipo */}
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
                  <Icon className={cn('w-5 h-5', cfg.text)} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-finca-dark truncate leading-snug">
                    {documento.nombre}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge className={cn('text-[10px] border-0 px-1.5', cfg.badge)}>
                      {cfg.label}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">
                      {format(new Date(documento.created_at), 'd MMM yyyy', { locale: es })}
                    </span>
                  </div>
                </div>

                {/* Acción */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs border-finca-coral text-finca-coral hover:bg-finca-coral hover:text-white shrink-0"
                  onClick={() => descargar(documento)}
                >
                  <Download className="w-3.5 h-3.5 mr-1" />
                  Abrir
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Sheet subida ── */}
      <Sheet open={sheetOpen} onOpenChange={(o) => { setSheetOpen(o); if (!o) resetSheet(); }}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
          <SheetHeader className="pb-3">
            <SheetTitle className="text-left text-finca-dark">Subir documento</SheetTitle>
          </SheetHeader>

          <div className="space-y-5 pb-8">
            {/* Selector de archivo */}
            <div className="space-y-2">
              <Label>Archivo <span className="text-finca-coral">*</span></Label>

              {/* Zona de drop / click */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'w-full rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
                  errorArchivo
                    ? 'border-red-300 bg-red-50'
                    : archivoSeleccionado
                    ? 'border-finca-coral bg-finca-peach/10'
                    : 'border-border hover:border-finca-coral hover:bg-finca-peach/5'
                )}
                disabled={subiendo}
              >
                {archivoSeleccionado ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-finca-coral" />
                    <p className="text-sm font-medium text-finca-dark truncate max-w-[240px]">
                      {archivoSeleccionado.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(archivoSeleccionado.size / 1024 / 1024).toFixed(2)} MB ·{' '}
                      {tipoConfig(inferirTipo(archivoSeleccionado) ?? '').label}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-muted-foreground/50" />
                    <p className="text-sm font-medium text-finca-dark">Toca para seleccionar</p>
                    <p className="text-xs text-muted-foreground">PDF, Word o Excel · Máx. 20 MB</p>
                  </div>
                )}
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept={EXTENSIONES_ACEPTADAS}
                className="hidden"
                onChange={onFileChange}
                disabled={subiendo}
              />

              {errorArchivo && (
                <div className="flex items-center gap-2 text-red-500 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {errorArchivo}
                </div>
              )}
            </div>

            <Separator />

            {/* Nombre personalizado */}
            <div className="space-y-2">
              <Label htmlFor="nombre-doc">
                Nombre del documento <span className="text-finca-coral">*</span>
              </Label>
              <Input
                id="nombre-doc"
                placeholder="Ej: Acta de la junta 2025"
                value={nombrePersonalizado}
                onChange={(e) => setNombrePersonalizado(e.target.value)}
                disabled={subiendo}
              />
              <p className="text-xs text-muted-foreground">
                Este nombre verán todos los vecinos en la lista.
              </p>
            </div>

            {/* Barra de progreso */}
            {subiendo && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Subiendo...</span>
                  <span>{progreso}%</span>
                </div>
                <Progress value={progreso} className="h-2" />
              </div>
            )}

            {/* Botones */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setSheetOpen(false); resetSheet(); }}
                disabled={subiendo}
              >
                <X className="w-4 h-4 mr-1.5" />
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-finca-coral hover:bg-finca-coral/90 text-white"
                onClick={handleSubir}
                disabled={subiendo || !archivoSeleccionado || !nombrePersonalizado.trim()}
              >
                {subiendo ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-1.5" />
                    Subir
                  </>
                )}
              </Button>
            </div>

            {/* Info roles */}
            {!puedeSubir && (
              <p className="text-xs text-center text-muted-foreground">
                Solo administradores y presidentes pueden subir documentos.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

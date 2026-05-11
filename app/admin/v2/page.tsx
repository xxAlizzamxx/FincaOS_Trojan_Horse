'use client';

import { useState } from 'react';
import {
  FileText, Users, PenLine, Award, Home,
  BookOpen, BarChart3, Calculator, Receipt, Download, Building2,
  Wrench, Calendar, History, Hammer, Shield, Zap,
  Bot, BellRing, Search, Sparkles, Clock,
  Building, LayoutDashboard, PieChart, ShoppingBag, Activity, Lock, Send,
  TrendingDown, TrendingUp, MessageSquare, Cpu,
  Database, UserCheck, Cloud, ClipboardCheck, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type BadgeType = 'V2' | 'Beta' | 'En desarrollo';

interface Feature {
  icon: React.ElementType;
  label:  string;
  desc:   string;
  badge:  BadgeType;
}

interface Categoria {
  emoji:       string;
  titulo:      string;
  descripcion: string;
  accent:      string;       // tailwind color token (e.g. "indigo")
  headerFrom:  string;
  headerTo:    string;
  features:    Feature[];
}

// ── Data ─────────────────────────────────────────────────────────────────────

const CATEGORIAS: Categoria[] = [
  {
    emoji:       '🏛',
    titulo:      'Gestión Administrativa',
    descripcion: 'Centraliza toda la gestión legal y documental de la comunidad.',
    accent:      'indigo',
    headerFrom:  'from-indigo-600',
    headerTo:    'to-indigo-400',
    features: [
      { icon: FileText,  label: 'Libro de actas digitales',        desc: 'Genera y almacena actas oficiales con un clic',           badge: 'V2'           },
      { icon: Users,     label: 'Gestión de reuniones y quórum',   desc: 'Convoca, gestiona asistencia y calcula quórum automático', badge: 'V2'           },
      { icon: PenLine,   label: 'Firmas digitales',                desc: 'Documentos con firma electrónica legalmente válida',       badge: 'Beta'         },
      { icon: Award,     label: 'Certificados automáticos',        desc: 'Deuda al día, certificados para notarías en segundos',     badge: 'V2'           },
      { icon: Home,      label: 'Portal propietario / inquilino',  desc: 'Perfiles y permisos diferenciados por tipo de vecino',     badge: 'En desarrollo'},
    ],
  },
  {
    emoji:       '💰',
    titulo:      'Finanzas Inteligentes',
    descripcion: 'Automatiza la administración financiera y reduce procesos manuales.',
    accent:      'emerald',
    headerFrom:  'from-emerald-600',
    headerTo:    'to-teal-400',
    features: [
      { icon: BookOpen,  label: 'Contabilidad avanzada',       desc: 'Balance completo con cierre mensual para la gestoría',          badge: 'V2'           },
      { icon: BarChart3, label: 'Balance ingresos / gastos',   desc: 'Visualiza el estado financiero real de la comunidad',           badge: 'En desarrollo'},
      { icon: Calculator,label: 'Derramas automáticas',        desc: 'Cálculo por coeficiente de participación con recibos',          badge: 'V2'           },
      { icon: Receipt,   label: 'Facturación de proveedores',  desc: 'Vincula facturas PDF a gastos e incidencias',                   badge: 'V2'           },
      { icon: Download,  label: 'Exportación Excel / PDF',     desc: 'Envía reportes contables a la gestoría con un clic',            badge: 'Beta'         },
      { icon: Building2, label: 'Integración bancaria',        desc: 'Open banking: reconcilia pagos automáticamente',                badge: 'V2'           },
    ],
  },
  {
    emoji:       '🛠',
    titulo:      'Operaciones y Mantenimiento',
    descripcion: 'Control total sobre infraestructura, servicios y mantenimientos.',
    accent:      'amber',
    headerFrom:  'from-amber-500',
    headerTo:    'to-orange-400',
    features: [
      { icon: Wrench,   label: 'Mantenimientos preventivos',  desc: 'Agenda y recordatorios: ascensor, piscina, jardín…',  badge: 'En desarrollo'},
      { icon: Calendar, label: 'Agenda automática',           desc: 'Recordatorios programados sin intervención manual',   badge: 'V2'           },
      { icon: History,  label: 'Historial de reparaciones',   desc: 'Todo el historial de cada zona con documentación',    badge: 'V2'           },
      { icon: Hammer,   label: 'Registro de obras y reformas',desc: 'Documentación con fotos antes/después y garantías',   badge: 'V2'           },
      { icon: Shield,   label: 'Garantías y seguimiento',     desc: 'Control de garantías activas por obra o reparación',  badge: 'V2'           },
      { icon: Zap,      label: 'Comparativa de consumos',     desc: 'Agua, luz, gas — IA detecta anomalías de consumo',    badge: 'Beta'         },
    ],
  },
  {
    emoji:       '🤖',
    titulo:      'IA y Automatización',
    descripcion: 'Inteligencia artificial aplicada a la operación diaria de comunidades.',
    accent:      'violet',
    headerFrom:  'from-violet-600',
    headerTo:    'to-purple-400',
    features: [
      { icon: Bot,          label: 'Mediación inteligente IA',   desc: 'IA sugiere resoluciones antes de escalar conflictos',      badge: 'Beta'         },
      { icon: BellRing,     label: 'Alertas predictivas',        desc: 'Anticipa incidencias antes de que ocurran',                badge: 'V2'           },
      { icon: Search,       label: 'Detección de anomalías',     desc: 'Patrones inusuales en consumos y gastos detectados',       badge: 'V2'           },
      { icon: Sparkles,     label: 'Clasificación automática',   desc: 'Las incidencias se priorizan y clasifican solas',          badge: 'Beta'         },
      { icon: FileText,     label: 'Resúmenes automáticos',      desc: 'Informe diario del estado de la comunidad sin esfuerzo',   badge: 'Beta'         },
      { icon: Clock,        label: 'SLA de atención',            desc: 'Tiempo de respuesta garantizado y métricas de cumplimiento', badge: 'V2'         },
    ],
  },
  {
    emoji:       '🏢',
    titulo:      'Gestión Profesional',
    descripcion: 'Diseñado para administradores profesionales y empresas inmobiliarias.',
    accent:      'blue',
    headerFrom:  'from-blue-600',
    headerTo:    'to-cyan-400',
    features: [
      { icon: Building,         label: 'Multi-comunidad',           desc: 'Gestiona 10, 50 o 200 comunidades desde un panel',       badge: 'V2'           },
      { icon: LayoutDashboard,  label: 'Dashboard corporativo',     desc: 'Vista ejecutiva para empresas administradoras',          badge: 'V2'           },
      { icon: PieChart,         label: 'Analíticas avanzadas',      desc: 'KPIs, tendencias y comparativas entre comunidades',      badge: 'V2'           },
      { icon: ShoppingBag,      label: 'Marketplace de proveedores',desc: 'Proveedores verificados compiten por tus trabajos',      badge: 'Beta'         },
      { icon: Lock,             label: 'Roles avanzados',           desc: 'Gestor, subdirector, subcontratista y permisos custom',  badge: 'V2'           },
      { icon: Activity,         label: 'Métricas operativas',       desc: 'OKRs y rendimiento operativo por comunidad',             badge: 'V2'           },
    ],
  },
];

// ── Badge config ─────────────────────────────────────────────────────────────

const BADGE_CONFIG: Record<BadgeType, { label: string; className: string }> = {
  'V2':           { label: 'V2',           className: 'bg-finca-coral/15 text-finca-coral border border-finca-coral/30' },
  'Beta':         { label: 'Beta',         className: 'bg-blue-50 text-blue-600 border border-blue-200'                },
  'En desarrollo':{ label: 'En desarrollo',className: 'bg-amber-50 text-amber-600 border border-amber-200'             },
};

// ── Color maps ───────────────────────────────────────────────────────────────

const ICON_BG: Record<string, string> = {
  indigo:  'bg-indigo-50  text-indigo-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber:   'bg-amber-50   text-amber-600',
  violet:  'bg-violet-50  text-violet-600',
  blue:    'bg-blue-50    text-blue-600',
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function V2Page() {
  const totalFeatures = CATEGORIAS.reduce((s, c) => s + c.features.length, 0);
  const [sugerencia, setSugerencia] = useState('');
  const [enviado, setEnviado] = useState(false);

  const handleEnviar = () => {
    if (sugerencia.trim()) {
      setEnviado(true);
      setTimeout(() => {
        setSugerencia('');
        setEnviado(false);
      }, 2000);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-12">

      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-finca-coral to-finca-salmon px-8 py-10 text-white">
        {/* decorative blobs */}
        <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-finca-coral/20 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 w-48 h-48 rounded-full bg-finca-coral/10 blur-3xl" />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 bg-white/20 border border-white/30 text-white text-xs font-semibold px-3 py-1 rounded-full mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            FincaOS V2 — Roadmap oficial
          </div>

          <h1 className="text-3xl font-bold mb-2">🚀 Próximas funcionalidades</h1>
          <p className="text-white/60 text-sm max-w-xl">
            Nuevos módulos avanzados en desarrollo para la siguiente versión de FincaOS.
            Estas funcionalidades están en camino para hacer de FincaOS la plataforma definitiva
            de gestión de comunidades de propiedad horizontal.
          </p>

          <div className="flex flex-wrap gap-4 mt-6">
            {[
              { label: 'Módulos nuevos', value: 6 },
              { label: 'Funcionalidades', value: totalFeatures },
              { label: 'Categorías', value: CATEGORIAS.length },
            ].map(stat => (
              <div key={stat.label} className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-center">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-[11px] text-white/50">{stat.label}</p>
              </div>
            ))}
            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-center">
              <p className="text-2xl font-bold text-white">2026</p>
              <p className="text-[11px] text-white/50">Lanzamiento V2</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Categories ── */}
      {CATEGORIAS.map((cat) => (
        <section key={cat.titulo} className="space-y-4">

          {/* Category header */}
          <div className="flex items-start gap-3">
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 mt-0.5',
              `bg-gradient-to-br ${cat.headerFrom} ${cat.headerTo}`,
            )}>
              <span>{cat.emoji}</span>
            </div>
            <div>
              <h2 className="text-base font-bold text-finca-dark">{cat.titulo}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{cat.descripcion}</p>
            </div>
          </div>

          {/* Feature cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cat.features.map((feat) => {
              const badge = BADGE_CONFIG[feat.badge];
              const iconStyle = ICON_BG[cat.accent];
              return (
                <div
                  key={feat.label}
                  className="group relative bg-card border border-border rounded-xl p-4 flex flex-col gap-3 hover:shadow-md hover:border-finca-coral/30 transition-all duration-200"
                >
                  {/* Icon + Badge row */}
                  <div className="flex items-center justify-between">
                    <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', iconStyle)}>
                      <feat.icon className="w-4.5 h-4.5" />
                    </div>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', badge.className)}>
                      {badge.label}
                    </span>
                  </div>

                  {/* Text */}
                  <div>
                    <p className="text-sm font-semibold text-finca-dark leading-snug">{feat.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{feat.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {/* ── Cumplimiento y Seguridad ── */}
      <section className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 mt-0.5 bg-gradient-to-br from-emerald-600 to-teal-400">
            <span>🔒</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-finca-dark">Cumplimiento y Seguridad</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Diseñado para que administradores operen con total tranquilidad legal y técnica.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { icon: Shield,        label: 'Protección de datos GDPR',      desc: 'Cumplimiento total con el Reglamento europeo de protección de datos' },
            { icon: Database,      label: 'Backups automáticos',            desc: 'Copias de seguridad diarias cifradas en la nube sin intervención' },
            { icon: ClipboardCheck,label: 'Historial y auditoría',          desc: 'Registro completo de cada acción realizada en la plataforma' },
            { icon: UserCheck,     label: 'Acceso seguro por roles',        desc: 'Permisos granulares: admin, presidente, vecino, proveedor' },
            { icon: Cloud,         label: 'Infraestructura cloud segura',   desc: 'Alojamiento en servidores certificados ISO 27001 con alta disponibilidad' },
            { icon: ShieldCheck,   label: 'Autenticación segura',           desc: 'Login con verificación en dos pasos y sesiones protegidas' },
          ].map((item) => (
            <div key={item.label} className="group bg-card border border-border rounded-xl p-4 flex gap-3 hover:shadow-md hover:border-emerald-300 transition-all">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                <item.icon className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-finca-dark leading-snug">{item.label}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Impacto esperado ── */}
      <section className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0 mt-0.5 bg-gradient-to-br from-finca-coral to-finca-salmon">
            <span>📈</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-finca-dark">Impacto esperado</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Resultados medibles para tu comunidad desde el primer mes.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: TrendingDown, value: '−70%', label: 'tiempo administrativo',   color: 'text-finca-coral', bg: 'bg-finca-coral/8' },
            { icon: TrendingDown, value: '−60%', label: 'incidencias sin seguimiento', color: 'text-finca-coral', bg: 'bg-finca-coral/8' },
            { icon: MessageSquare,value: '↑',    label: 'comunicación vecinal',    color: 'text-emerald-600', bg: 'bg-emerald-50' },
            { icon: Cpu,          value: '↑',    label: 'automatización operativa', color: 'text-violet-600',  bg: 'bg-violet-50'  },
          ].map((m) => (
            <div key={m.label} className="bg-card border border-border rounded-xl p-4 flex flex-col items-center text-center gap-2 hover:shadow-md hover:border-finca-coral/30 transition-all">
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', m.bg)}>
                <m.icon className={cn('w-5 h-5', m.color)} />
              </div>
              <p className={cn('text-2xl font-extrabold leading-none', m.color)}>{m.value}</p>
              <p className="text-[11px] text-muted-foreground leading-snug">{m.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer CTA ── */}
      <div className="rounded-2xl border-2 border-dashed border-finca-coral/30 bg-finca-peach/10 p-8 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-finca-coral/10 flex items-center justify-center mx-auto">
          <Sparkles className="w-6 h-6 text-finca-coral" />
        </div>
        <h3 className="font-bold text-finca-dark text-lg">¿Tienes una funcionalidad en mente?</h3>

        {/* Input + Send */}
        <div className="flex gap-2 max-w-sm mx-auto">
          <input
            type="text"
            value={sugerencia}
            onChange={(e) => setSugerencia(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleEnviar()}
            placeholder="Comparte tu sugerencia..."
            className="flex-1 px-3 py-2 rounded-lg border border-finca-coral/20 bg-white text-sm focus:outline-none focus:border-finca-coral focus:ring-2 focus:ring-finca-coral/20"
            disabled={enviado}
          />
          <button
            onClick={handleEnviar}
            disabled={enviado || !sugerencia.trim()}
            className={cn(
              'px-3 py-2 rounded-lg font-medium text-sm transition-all',
              enviado
                ? 'bg-green-500 text-white'
                : 'bg-finca-coral hover:bg-finca-coral/90 text-white disabled:opacity-50'
            )}
          >
            {enviado ? '✓' : <Send className="w-4 h-4" />}
          </button>
        </div>

        {enviado && <p className="text-xs text-green-600 font-medium">¡Gracias por tu sugerencia!</p>}

        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Todas estas funcionalidades están en desarrollo activo. FincaOS V2 será la plataforma
          definitiva para la gestión de comunidades en España.
        </p>
        <div className="flex items-center justify-center gap-2 pt-2">
          <span className="inline-flex gap-1">
            <span className="w-2 h-2 rounded-full bg-finca-coral animate-pulse" />
            <span className="w-2 h-2 rounded-full bg-finca-coral animate-pulse" style={{ animationDelay: '0.2s' }} />
            <span className="w-2 h-2 rounded-full bg-finca-coral animate-pulse" style={{ animationDelay: '0.4s' }} />
          </span>
          <span className="text-xs font-medium text-finca-coral">En desarrollo activo</span>
        </div>
      </div>
    </div>
  );
}

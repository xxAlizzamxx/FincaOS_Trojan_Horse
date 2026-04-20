'use client';

import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * Toaster alineado con la paleta FincaOS (cream / coral / peach).
 * - Fondo claro fijo (ignora preferencia dark del SO) para mantener consistencia.
 * - Cada tipo usa un borde lateral coloreado + fondo tinte suave, en vez de
 *   los bloques saturados de `richColors`.
 * - Ícono lateral con color semántico, texto en finca-dark.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: [
            'group toast',
            'flex items-start gap-3',
            'rounded-2xl border border-border/60 bg-card text-finca-dark',
            'shadow-lg shadow-finca-dark/5',
            'ring-1 ring-black/[0.02]',
            'px-4 py-3',
          ].join(' '),
          title:       'text-sm font-semibold text-finca-dark',
          description: 'text-xs text-muted-foreground mt-0.5',
          actionButton:
            'bg-finca-coral text-white rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-finca-coral/90',
          cancelButton:
            'bg-muted text-muted-foreground rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-muted/80',
          closeButton:
            'bg-card border border-border/60 text-muted-foreground hover:text-finca-dark',
          // Tipos — borde izquierdo con color semántico + tinte de fondo muy suave
          success: '!border-l-4 !border-l-green-500  !bg-green-50/60',
          error:   '!border-l-4 !border-l-red-500    !bg-red-50/60',
          warning: '!border-l-4 !border-l-orange-500 !bg-orange-50/60',
          info:    '!border-l-4 !border-l-finca-coral !bg-finca-peach/40',
          loading: '!border-l-4 !border-l-finca-coral !bg-finca-peach/30',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

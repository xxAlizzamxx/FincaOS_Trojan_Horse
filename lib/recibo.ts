/**
 * Generates a payment receipt PDF client-side using jsPDF.
 * Dynamic import keeps jsPDF out of the initial bundle.
 */

export interface ReciboData {
  tipo:        'cuota' | 'cobro' | 'mediacion' | 'incidencia';
  concepto:    string;
  monto:       number;
  fecha:       string;   // ISO string
  nombre:      string;   // Vecino name
  comunidad:   string;   // Community name
  pagoId:      string;
}

export async function generarReciboPDF(data: ReciboData): Promise<void> {
  const { jsPDF, GState } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const coral  = [255, 99,  71] as const;
  const dark   = [26,  26,  46] as const;
  const gray   = [120, 120, 140] as const;
  const green  = [22,  163, 74] as const;
  const white  = [255, 255, 255] as const;
  const light  = [248, 248, 252] as const;

  const W = 210;

  // ── Header background ──
  doc.setFillColor(...coral);
  doc.rect(0, 0, W, 45, 'F');

  // Logo text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(...white);
  doc.text('FincaOS', 20, 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(255, 220, 210);
  doc.text('Comprobante de pago', 20, 32);

  // Receipt number right-aligned
  doc.setFontSize(8);
  doc.setTextColor(255, 240, 235);
  doc.text(`Ref: ${data.pagoId.slice(0, 12).toUpperCase()}`, W - 20, 22, { align: 'right' });
  doc.text(`Fecha: ${new Date(data.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })}`, W - 20, 30, { align: 'right' });

  // ── Main content card ──
  doc.setFillColor(...light);
  doc.roundedRect(15, 52, W - 30, 110, 4, 4, 'F');

  // Tipo badge
  const tipoLabel: Record<string, string> = {
    cuota: 'Cuota de comunidad', cobro: 'Cobro', mediacion: 'Mediación', incidencia: 'Reparación',
  };
  doc.setFillColor(...coral);
  doc.roundedRect(20, 58, 50, 7, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...white);
  doc.text(tipoLabel[data.tipo] ?? data.tipo, 45, 63, { align: 'center' });

  // Concepto
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...dark);
  doc.text(data.concepto, 20, 78);

  // Amount
  doc.setFillColor(...coral);
  doc.roundedRect(20, 85, W - 50, 22, 3, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(...white);
  doc.text(`${data.monto.toFixed(2)} €`, (W - 10) / 2, 100, { align: 'center' });

  // Details rows
  const rows: Array<[string, string]> = [
    ['Vecino',     data.nombre],
    ['Comunidad',  data.comunidad],
    ['Concepto',   data.concepto],
    ['Fecha pago', new Date(data.fecha).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' })],
    ['ID de pago', data.pagoId],
    ['Estado',     'PAGADO'],
  ];

  let y = 116;
  rows.forEach(([label, value], i) => {
    if (i % 2 === 0) {
      doc.setFillColor(240, 240, 248);
      doc.rect(20, y - 4, W - 40, 10, 'F');
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    doc.text(label, 25, y + 2);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(label === 'Estado' ? green[0] : dark[0], label === 'Estado' ? green[1] : dark[1], label === 'Estado' ? green[2] : dark[2]);
    doc.text(value, W - 25, y + 2, { align: 'right', maxWidth: 110 });
    y += 11;
  });

  // ── Paid stamp ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.setTextColor(22, 163, 74);
  doc.setGState(new GState({ opacity: 0.12 }));
  doc.text('PAGADO', W / 2, 120, { align: 'center', angle: 30 });
  doc.setGState(new GState({ opacity: 1 }));

  // ── Footer ──
  doc.setFillColor(...coral);
  doc.rect(0, 280, W, 17, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...white);
  doc.text('Este documento es un comprobante electrónico de pago emitido por FincaOS.', W / 2, 288, { align: 'center' });
  doc.text('fincaos.app', W / 2, 294, { align: 'center' });

  const fecha = new Date(data.fecha).toISOString().split('T')[0];
  doc.save(`recibo-${data.tipo}-${fecha}.pdf`);
}

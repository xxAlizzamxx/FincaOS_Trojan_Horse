'use client';

import { useEffect, useState } from 'react';

/**
 * Generates a QR code data URL client-side using the `qrcode` library.
 * Returns null while loading, and the data URL once ready.
 * Falls back gracefully — never throws to the component.
 */
export function useQR(data: string | null | undefined): {
  qrUrl: string | null;
  loading: boolean;
  error: boolean;
} {
  const [qrUrl, setQrUrl]   = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(false);

  useEffect(() => {
    if (!data) { setQrUrl(null); return; }

    let cancelled = false;
    setLoading(true);
    setError(false);
    setQrUrl(null);

    import('qrcode').then((QRCode) => {
      return QRCode.default.toDataURL(data, {
        width:          300,
        margin:         2,
        color: { dark: '#1a1a2e', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      });
    }).then((url) => {
      if (!cancelled) { setQrUrl(url); setLoading(false); }
    }).catch(() => {
      if (!cancelled) { setError(true); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [data]);

  return { qrUrl, loading, error };
}

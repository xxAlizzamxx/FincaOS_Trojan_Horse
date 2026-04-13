import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// ── DEBUG: verificar config en producción ──────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  console.log('[Firebase] PROJECT_ID :', firebaseConfig.projectId);
  console.log('[Firebase] AUTH_DOMAIN:', firebaseConfig.authDomain);
}
// En producción siempre logueamos para detectar vars vacías
if (typeof window !== 'undefined') {
  console.log('[Firebase] projectId  :', firebaseConfig.projectId);
  console.log('[Firebase] authDomain :', firebaseConfig.authDomain);
  console.log('[Firebase] currentHost:', window.location.origin);
  if (!firebaseConfig.projectId || !firebaseConfig.authDomain) {
    console.error('[Firebase] ⚠️  Variables de entorno VACÍAS — revisa Vercel → Settings → Environment Variables');
  }
}
// ──────────────────────────────────────────────────────────────────────────

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;

/**
 * Firebase Admin SDK — server-side Firestore access (used by API routes / webhooks).
 *
 * Required env vars (add to .env.local AND Vercel dashboard):
 *   FIREBASE_ADMIN_PROJECT_ID   → e.g. "fincaostrojanhorse"
 *   FIREBASE_ADMIN_CLIENT_EMAIL → from Firebase console > Project settings > Service accounts
 *   FIREBASE_ADMIN_PRIVATE_KEY  → from the downloaded service account JSON (include the full key with \n)
 */
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

let _db: Firestore | null = null;

export function getAdminDb(): Firestore {
  if (_db) return _db;

  let app: App;
  if (getApps().length > 0) {
    app = getApps()[0];
  } else {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  }

  _db = getFirestore(app);
  return _db;
}

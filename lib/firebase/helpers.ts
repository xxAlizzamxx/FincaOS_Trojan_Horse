import {
  collection,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  QueryConstraint,
} from 'firebase/firestore';
import { db } from './client';

export async function queryCollection<T>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> {
  const q = query(collection(db, collectionName), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
}

export async function getDocument<T>(collectionName: string, id: string): Promise<T | null> {
  const snap = await getDoc(doc(db, collectionName, id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as T;
}

export async function addDocument(collectionName: string, data: Record<string, any>): Promise<string> {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    created_at: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateDocument(collectionName: string, id: string, data: Record<string, any>) {
  await updateDoc(doc(db, collectionName, id), {
    ...data,
    updated_at: new Date().toISOString(),
  });
}

export async function deleteDocument(collectionName: string, id: string) {
  await deleteDoc(doc(db, collectionName, id));
}

export { where, orderBy, firestoreLimit as limit, collection, query, getDocs, doc };

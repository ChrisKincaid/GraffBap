import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyB_Rgi9EAUpigcL8-f9SaiiEF-bHzHMq38',
  authDomain: 'boombapboombox-a5b78.firebaseapp.com',
  projectId: 'boombapboombox-a5b78',
  storageBucket: 'boombapboombox-a5b78.firebasestorage.app',
  messagingSenderId: '912003553919',
  appId: '1:912003553919:web:cf5e9ed06b983643ce3d4a',
};

const GHOST_YARDS = 'graffiti_ghost_yards';
const PUBLIC_YARDS = 'graffiti_public_yards';

export type PublicYardId =
  | 'quick_20m'
  | 'junkyard'
  | 'hot_5m'
  | 'rust_bucket'
  | 'intermodal'
  | 'sub_esplanade'
  | 'sub_1tunnel'
  | 'sub_baychester'
  | 'sub_corona'
  | 'sub_pitkin';

export interface PublicCarData {
  carDataUrl: string;
  lastHitAt: Timestamp | null;
  lastWriter: string;
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const RTDB_URL = import.meta.env.VITE_FIREBASE_RTDB_URL || 'https://boombapboombox-a5b78-default-rtdb.firebaseio.com';
export const rtdb = getDatabase(app, RTDB_URL);

// This project has no '(default)' database; the boombapboombox Admin app uses the named 'main' database.
const FIRESTORE_DATABASE_ID = import.meta.env.VITE_FIREBASE_DATABASE_ID || 'main';

export const db = (() => {
  try {
    return getFirestore(app, FIRESTORE_DATABASE_ID);
  } catch (err) {
    console.error(`Firestore init failed for database "${FIRESTORE_DATABASE_ID}"`, err);
    throw err;
  }
})();

// Everyone gets a real uid on arrival, so anonymous work still has an owner.
export function ensureAnonymous() {
  return auth.currentUser ? Promise.resolve(auth.currentUser) : signInAnonymously(auth).then((c) => c.user);
}

// Linking keeps the same uid, so pieces painted anonymously carry over to the profile.
const linkOrSignIn = async (user: User | null, run: (u: User) => Promise<unknown>, fallback: () => Promise<unknown>) => {
  if (!user?.isAnonymous) return fallback();
  try {
    return await run(user);
  } catch (err) {
    // Credential already belongs to a real profile: sign into that one instead.
    if ((err as { code?: string }).code === 'auth/credential-already-in-use') return fallback();
    throw err;
  }
};

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return linkOrSignIn(auth.currentUser, (u) => linkWithPopup(u, provider), () => signInWithPopup(auth, provider));
}

export function signInWithGithub() {
  const provider = new GithubAuthProvider();
  return linkOrSignIn(auth.currentUser, (u) => linkWithPopup(u, provider), () => signInWithPopup(auth, provider));
}

export function signInWithEmail(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function registerWithEmail(email: string, password: string) {
  const cred = EmailAuthProvider.credential(email, password);
  return linkOrSignIn(
    auth.currentUser,
    (u) => linkWithCredential(u, cred),
    () => createUserWithEmailAndPassword(auth, email, password),
  );
}

export function signOutUser() {
  return signOut(auth);
}

function ghostCarRef(userId: string, carIndex: number) {
  return doc(db, GHOST_YARDS, userId, 'cars', String(carIndex));
}

function publicCarRef(yardId: PublicYardId, carIndex: number) {
  return doc(db, PUBLIC_YARDS, yardId, 'cars', String(carIndex));
}

export function saveGhostYard(userId: string, dataUrl: string, carIndex = 0) {
  return setDoc(ghostCarRef(userId, carIndex), { carDataUrl: dataUrl, updatedAt: Date.now() });
}

export async function loadGhostYard(
  userId: string,
  carIndex = 0,
): Promise<{ carDataUrl: string; updatedAt: number } | null> {
  let snap = await getDoc(ghostCarRef(userId, carIndex));
  // Car 1 was originally saved on the root user doc.
  if (!snap.exists() && carIndex === 0) snap = await getDoc(doc(db, GHOST_YARDS, userId));
  return snap.exists() ? (snap.data() as { carDataUrl: string; updatedAt: number }) : null;
}

export function savePublicYardCar(yardId: PublicYardId, carIndex: number, dataUrl: string, writer: string) {
  return setDoc(publicCarRef(yardId, carIndex), {
    carDataUrl: dataUrl,
    lastHitAt: serverTimestamp(),
    lastWriter: writer,
  });
}

// `local` is true for this client's own not-yet-committed writes.
export async function listPublicYardCars(yardId: PublicYardId): Promise<{ index: number; data: PublicCarData }[]> {
  const snap = await getDocs(collection(db, PUBLIC_YARDS, yardId, 'cars'));
  return snap.docs
    .map((d) => ({ index: Number(d.id), data: d.data() as PublicCarData }))
    .filter((c) => Number.isInteger(c.index) && typeof c.data.carDataUrl === 'string');
}

// `local` is true for this client's own not-yet-committed writes.
export function watchPublicYardCar(
  yardId: PublicYardId,
  carIndex: number,
  onData: (data: PublicCarData | null, local: boolean) => void,
  onError: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    publicCarRef(yardId, carIndex),
    (snap) => onData(snap.exists() ? (snap.data() as PublicCarData) : null, snap.metadata.hasPendingWrites),
    onError,
  );
}

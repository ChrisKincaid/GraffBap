import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from './firebase';

// Global car registry: every departed piece, its lifecycle status and community score.
export type CarStatus = 'departed' | 'hall_of_fame' | 'museum' | 'buffed' | 'banned' | 'quarantined';
export type FeedSort = 'top' | 'grave' | 'latest' | 'oldest' | 'random' | 'painting';

export interface RegistryCar {
  id: string;
  yard: string;
  division: 'freight' | 'subway';
  slot: number;
  writer: string;
  writerUid: string | null;
  image: string;
  createdAt: number;
  departedAt: number;
  updatedAt: number;
  status: CarStatus;
  props: number;
  toys: number;
  net: number;
  reports: number;
  buffScore: number;
  rnd: number;
  recentVotes: number[];
  hofAt?: number;
  basedOn?: string;
  basedOnWriter?: string;
}

// A car touched within this window is still being worked on, so it can't be rated yet.
export const PAINTING_WINDOW_MS = 2 * 60_000;
export const isBeingPainted = (c: Pick<RegistryCar, 'updatedAt'>, now = Date.now()) =>
  !!c.updatedAt && now - c.updatedAt < PAINTING_WINDOW_MS;

export const HOF_BASE = 5;
export const HOF_STEP = 10;
export const HOF_BATCH = 50;
export const HOF_ROLLING_CAP = 100;
export const ACTIVE_CAP = 5000;
export const REPORT_LIMIT = 25;
const DAY_MS = 86_400_000;
const RECENT_WINDOW_MS = 30 * DAY_MS;
// Rolling feeds only ever show these; buffed/banned/quarantined/museum never roll.
const ROLLING: CarStatus[] = ['departed', 'hall_of_fame'];

const CARS = 'graffiti_cars';
const statsRef = () => doc(db, 'graffiti_meta', 'stats');
const carRef = (id: string) => doc(db, CARS, id);

interface Stats {
  active: number;
  hofTotal: number;
  hofActive: number;
}

export const hofThreshold = (hofTotal: number) => HOF_BASE + HOF_STEP * Math.floor(hofTotal / HOF_BATCH);

export function buffScore(props: number, toys: number, recentVotes: number[], createdAt: number, now = Date.now()): number {
  const recent = recentVotes.filter((t) => now - t <= RECENT_WINDOW_MS).length;
  const days = Math.max(1, (now - createdAt) / DAY_MS);
  return props - 2 * toys + recent / days;
}

function readStats(v: unknown): Stats {
  const s = (v ?? {}) as Partial<Stats>;
  return { active: s.active ?? 0, hofTotal: s.hofTotal ?? 0, hofActive: s.hofActive ?? 0 };
}

const toCar = (id: string, v: unknown): RegistryCar => ({ ...(v as Omit<RegistryCar, 'id'>), id });

export async function registerDeparture(
  c: Pick<RegistryCar, 'yard' | 'division' | 'slot' | 'writer' | 'writerUid' | 'image' | 'createdAt'> &
    Partial<Pick<RegistryCar, 'basedOn' | 'basedOnWriter'>>,
): Promise<string> {
  const ref = doc(collection(db, CARS));
  const now = Date.now();
  const car: Omit<RegistryCar, 'id'> = {
    ...c,
    departedAt: now,
    updatedAt: now,
    status: 'departed',
    props: 0,
    toys: 0,
    net: 0,
    reports: 0,
    buffScore: buffScore(0, 0, [], c.createdAt, now),
    rnd: Math.random(),
    recentVotes: [],
  };
  const batch = writeBatch(db);
  batch.set(ref, car);
  batch.set(statsRef(), { active: increment(1) }, { merge: true });
  await batch.commit();
  await cullIfNeeded();
  return ref.id;
}

// Autosave while painting: only the artwork and its freshness stamp move.
export async function updatePieceImage(id: string, image: string): Promise<void> {
  await setDoc(carRef(id), { image, updatedAt: Date.now() }, { merge: true });
}

// Pulling your own piece off the line: it stops rolling but the document is kept.
export async function retirePiece(id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(carRef(id), { status: 'buffed' });
  batch.set(statsRef(), { active: increment(-1) }, { merge: true });
  await batch.commit();
}

export async function getRegistryCar(id: string): Promise<RegistryCar | null> {
  const snap = await getDoc(carRef(id));
  return snap.exists() ? toCar(id, snap.data()) : null;
}

// Past 5,000 rolling cars, the lowest buff scores among standard (non-HoF) cars get buffed.
async function cullIfNeeded(): Promise<number> {
  const stats = readStats((await getDoc(statsRef())).data());
  const excess = stats.active - ACTIVE_CAP;
  if (excess <= 0) return 0;
  const snap = await getDocs(query(collection(db, CARS), where('status', '==', 'departed'), orderBy('buffScore', 'asc'), limit(excess)));
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { status: 'buffed' }));
  batch.set(statsRef(), { active: increment(-snap.size) }, { merge: true });
  await batch.commit();
  return snap.size;
}

export interface VoteResult {
  car: RegistryCar;
  already: boolean;
  promoted: boolean;
}

// One vote per profile per car; switching moves the vote. HoF promotion happens in the same transaction.
export async function voteRegistryCar(id: string, uid: string, kind: 'props' | 'toy'): Promise<VoteResult> {
  const voteRef = doc(db, CARS, id, 'votes', uid);
  const res = await runTransaction(db, async (tx) => {
    const [carSnap, voteSnap, statsSnap] = await Promise.all([tx.get(carRef(id)), tx.get(voteRef), tx.get(statsRef())]);
    if (!carSnap.exists()) throw new Error('Car not found');
    const car = toCar(id, carSnap.data());
    const prev = voteSnap.exists() ? (voteSnap.data().kind as 'props' | 'toy') : null;
    if (prev === kind) return { car, already: true, promoted: false, hofActive: 0 };
    const now = Date.now();
    let { props, toys } = car;
    if (prev === 'props') props = Math.max(0, props - 1);
    if (prev === 'toy') toys = Math.max(0, toys - 1);
    if (kind === 'props') props++;
    else toys++;
    const recentVotes = [...(car.recentVotes ?? []).filter((t) => now - t <= RECENT_WINDOW_MS), now].slice(-200);
    const net = props - toys;
    const stats = readStats(statsSnap.data());
    const promoted = car.status === 'departed' && net >= hofThreshold(stats.hofTotal);
    const patch: Partial<RegistryCar> = {
      props,
      toys,
      net,
      recentVotes,
      buffScore: buffScore(props, toys, recentVotes, car.createdAt, now),
    };
    if (promoted) {
      patch.status = 'hall_of_fame';
      patch.hofAt = now;
      tx.set(statsRef(), { hofTotal: increment(1), hofActive: increment(1) }, { merge: true });
    }
    tx.update(carRef(id), patch);
    tx.set(voteRef, { kind, at: now });
    return { car: { ...car, ...patch }, already: false, promoted, hofActive: stats.hofActive + (promoted ? 1 : 0) };
  });
  if (res.promoted && res.hofActive > HOF_ROLLING_CAP) await retireToMuseum(res.hofActive - HOF_ROLLING_CAP);
  return { car: res.car, already: res.already, promoted: res.promoted };
}

// Keeps at most 100 HoF cars rolling; the lowest-scoring (then oldest) move to the Museum.
async function retireToMuseum(count: number): Promise<void> {
  const snap = await getDocs(
    query(collection(db, CARS), where('status', '==', 'hall_of_fame'), orderBy('net', 'asc'), orderBy('hofAt', 'asc'), limit(count)),
  );
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.update(d.ref, { status: 'museum' }));
  batch.set(statsRef(), { hofActive: increment(-snap.size), active: increment(-snap.size) }, { merge: true });
  await batch.commit();
}

// One report per profile per car; 25 reports quarantine the car off every track.
export async function reportRegistryCar(id: string, uid: string): Promise<'already' | 'reported' | 'quarantined'> {
  const reportRef = doc(db, CARS, id, 'reports', uid);
  return runTransaction(db, async (tx) => {
    const [carSnap, repSnap] = await Promise.all([tx.get(carRef(id)), tx.get(reportRef)]);
    if (!carSnap.exists()) throw new Error('Car not found');
    if (repSnap.exists()) return 'already' as const;
    const car = toCar(id, carSnap.data());
    const reports = (car.reports ?? 0) + 1;
    const quarantine = reports >= REPORT_LIMIT && ROLLING.includes(car.status);
    tx.set(reportRef, { at: Date.now() });
    tx.update(carRef(id), quarantine ? { reports, status: 'quarantined' } : { reports });
    if (quarantine) {
      const stats: Record<string, unknown> = { active: increment(-1) };
      if (car.status === 'hall_of_fame') stats.hofActive = increment(-1);
      tx.set(statsRef(), stats, { merge: true });
    }
    return quarantine ? ('quarantined' as const) : ('reported' as const);
  });
}

export async function listFeed(division: 'freight' | 'subway', sort: FeedSort, n: number): Promise<RegistryCar[]> {
  const base: QueryConstraint[] = [where('division', '==', division), where('status', 'in', ROLLING)];
  const run = async (...extra: QueryConstraint[]) =>
    (await getDocs(query(collection(db, CARS), ...base, ...extra))).docs.map((d) => toCar(d.id, d.data()));
  if (sort === 'painting') {
    return run(where('updatedAt', '>', Date.now() - PAINTING_WINDOW_MS), orderBy('updatedAt', 'desc'), limit(n));
  }
  if (sort === 'latest') return run(orderBy('departedAt', 'desc'), limit(n));
  if (sort === 'oldest') return run(orderBy('departedAt', 'asc'), limit(n));
  if (sort !== 'random') return run(orderBy('net', sort === 'top' ? 'desc' : 'asc'), limit(n));
  const r = Math.random();
  const cars = await run(where('rnd', '>=', r), orderBy('rnd'), limit(n));
  if (cars.length < n) cars.push(...(await run(where('rnd', '<', r), orderBy('rnd'), limit(n - cars.length))));
  for (let i = cars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cars[i], cars[j]] = [cars[j]!, cars[i]!];
  }
  return cars;
}

// Cars this profile painted, newest touch first.
export async function listMine(uid: string, division: 'freight' | 'subway', n: number): Promise<RegistryCar[]> {
  const snap = await getDocs(
    query(
      collection(db, CARS),
      where('division', '==', division),
      where('status', 'in', ROLLING),
      where('writerUid', '==', uid),
      orderBy('updatedAt', 'desc'),
      limit(n),
    ),
  );
  return snap.docs.map((d) => toCar(d.id, d.data()));
}

export async function countPainting(division: 'freight' | 'subway'): Promise<number> {
  const snap = await getCountFromServer(
    query(
      collection(db, CARS),
      where('division', '==', division),
      where('status', 'in', ROLLING),
      where('updatedAt', '>', Date.now() - PAINTING_WINDOW_MS),
    ),
  );
  return snap.data().count;
}

export async function listMuseum(n: number): Promise<RegistryCar[]> {
  const snap = await getDocs(
    query(collection(db, CARS), where('status', 'in', ['hall_of_fame', 'museum']), orderBy('net', 'desc'), limit(n)),
  );
  return snap.docs.map((d) => toCar(d.id, d.data()));
}

export async function readHofStats(): Promise<{ hofTotal: number; threshold: number }> {
  const s = readStats((await getDoc(statsRef())).data());
  return { hofTotal: s.hofTotal, threshold: hofThreshold(s.hofTotal) };
}

export async function countMuseumCars(): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, CARS), where('status', '==', 'museum')));
  return snap.data().count;
}

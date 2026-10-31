import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  startAfter,
  where,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { httpsCallable } from 'firebase/functions';
import { graffitiFunctions, requireAbuseProtection } from './protected-actions';
import type { PromoAd } from './promoService';

// Global car registry: every departed piece, its lifecycle status and community score.
export type CarStatus = 'departed' | 'hall_of_fame' | 'museum' | 'buffed' | 'banned' | 'quarantined';
export type FeedSort = 'top' | 'grave' | 'latest' | 'oldest' | 'random';

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
  competitionId?: string;
  competitionVotes?: number;
}

export const HOF_BASE = 5;
export const HOF_STEP = 10;
export const HOF_BATCH = 50;
export const HOF_ROLLING_CAP = 100;
export const ACTIVE_CAP = 5000;
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
  const publish = httpsCallable<typeof c, { id: string }>(graffitiFunctions, 'graffitiPublish');
  return (await publish(c)).data.id;
}

// Autosave while painting: only the artwork and its freshness stamp move.
export async function updatePieceImage(id: string, image: string): Promise<void> {
  await setDoc(carRef(id), { image, updatedAt: Date.now() }, { merge: true });
}

// Pulling your own piece off the line: it stops rolling but the document is kept.
export async function retirePiece(id: string): Promise<void> {
  await httpsCallable<{ id: string }, { success: boolean }>(graffitiFunctions, 'graffitiRetire')({ id });
}

export async function getRegistryCar(id: string): Promise<RegistryCar | null> {
  const snap = await getDoc(carRef(id));
  return snap.exists() ? toCar(id, snap.data()) : null;
}

export interface VoteResult {
  car: RegistryCar;
  already: boolean;
  promoted: boolean;
}

// One vote per profile per car; switching moves the vote. HoF promotion happens in the same transaction.
export async function voteRegistryCar(id: string, kind: 'props' | 'toy'): Promise<VoteResult> {
  return voteTarget<RegistryCar>(id, kind, 'artwork');
}

export async function votePromoAd(id: string, kind: 'props' | 'toy'): Promise<{
  car: PromoAd; already: boolean; promoted: boolean;
}> {
  return voteTarget<PromoAd>(id, kind, 'promo');
}

async function voteTarget<T>(id: string, kind: 'props' | 'toy', target: 'artwork' | 'promo'): Promise<{
  car: T; already: boolean; promoted: boolean;
}> {
  requireAbuseProtection();
  return (await httpsCallable<{ id: string; kind: 'props' | 'toy'; target: 'artwork' | 'promo' }, {
    car: T; already: boolean; promoted: boolean;
  }>(
    graffitiFunctions, 'graffitiVote',
  )({ id, kind, target })).data;
}

export type ReportReason = 'harassment' | 'explicit' | 'hate' | 'spam' | 'other';

export interface CarComment {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: number;
}

export const COMMENT_MAX = 280;

// Newest 50 comments on a published piece, kept live while the wall is open.
export function watchComments(carId: string, onChange: (comments: CarComment[]) => void, onError: (err: unknown) => void): () => void {
  return onSnapshot(
    query(collection(db, 'graffiti_cars', carId, 'comments'), orderBy('at', 'desc'), limit(50)),
    (snap) => onChange(snap.docs.map((d) => ({
      id: d.id,
      uid: String(d.get('uid') ?? ''),
      name: String(d.get('name') ?? 'Writer'),
      text: String(d.get('text') ?? ''),
      at: Number(d.get('at') ?? 0),
    }))),
    onError,
  );
}

type CommentCall =
  | { action: 'post'; carId: string; text: string }
  | { action: 'delete'; carId: string; commentId: string }
  | { action: 'report'; carId: string; commentId: string; reason: ReportReason; captchaToken?: string };

async function commentCall<T>(data: CommentCall): Promise<T> {
  requireAbuseProtection();
  return (await httpsCallable<CommentCall, T>(graffitiFunctions, 'graffitiComment')(data)).data;
}

export function postComment(carId: string, text: string): Promise<CarComment> {
  return commentCall<CarComment>({ action: 'post', carId, text });
}

export async function deleteComment(carId: string, commentId: string): Promise<void> {
  await commentCall<{ success: boolean }>({ action: 'delete', carId, commentId });
}

export async function reportComment(carId: string, commentId: string, reason: ReportReason, captchaToken?: string): Promise<'already' | 'reported'> {
  return (await commentCall<{ result: 'already' | 'reported' }>({
    action: 'report', carId, commentId, reason, ...(captchaToken ? { captchaToken } : {}),
  })).result;
}

export async function reportRegistryCar(id: string, reason: ReportReason, captchaToken?: string, target: 'artwork' | 'promo' = 'artwork'): Promise<'already' | 'reported'> {
  requireAbuseProtection();
  return (await httpsCallable<
    { id: string; reason: ReportReason; captchaToken?: string; target: 'artwork' | 'promo' },
    { result: 'already' | 'reported' }
  >(graffitiFunctions, 'graffitiReport')({ id, reason, target, ...(captchaToken ? { captchaToken } : {}) })).data.result;
}

export interface FeedPager {
  readonly done: boolean;
  next(n: number): Promise<RegistryCar[]>;
}

// Walks a line in pages so a reel can keep coupling on cars as it rolls instead of
// downloading every car's inline artwork up front.
export function feedPager(division: 'freight' | 'subway', sort: FeedSort): FeedPager {
  const base: QueryConstraint[] = [where('division', '==', division), where('status', 'in', ROLLING)];
  const r = Math.random();
  // Random walks rnd >= r, then wraps round to rnd < r.
  let wrapped = false;
  let last: QueryDocumentSnapshot | undefined;
  let done = false;
  const order = (): QueryConstraint[] => {
    // Latest = most recently posted or re-posted, so edited pieces come back to the front.
    if (sort === 'latest') return [orderBy('updatedAt', 'desc')];
    if (sort === 'oldest') return [orderBy('departedAt', 'asc')];
    if (sort === 'random') return [where('rnd', wrapped ? '<' : '>=', r), orderBy('rnd')];
    return [orderBy('net', sort === 'top' ? 'desc' : 'asc')];
  };
  return {
    get done() {
      return done;
    },
    async next(n: number) {
      const out: RegistryCar[] = [];
      while (!done && out.length < n) {
        const want = n - out.length;
        const snap = await getDocs(
          query(collection(db, CARS), ...base, ...order(), ...(last ? [startAfter(last)] : []), limit(want)),
        );
        out.push(...snap.docs.map((d) => toCar(d.id, d.data())));
        last = snap.docs[snap.docs.length - 1] ?? last;
        if (snap.size < want) {
          if (sort === 'random' && !wrapped) {
            wrapped = true;
            last = undefined;
          } else {
            done = true;
          }
        }
      }
      if (sort === 'random') {
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [out[i], out[j]] = [out[j]!, out[i]!];
        }
      }
      return out;
    },
  };
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

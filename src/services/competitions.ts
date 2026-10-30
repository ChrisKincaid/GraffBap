import { collection, documentId, getDocs, limit, onSnapshot, orderBy, query, startAfter, where, type QueryDocumentSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db } from './firebase';
import { graffitiFunctions, requireAbuseProtection } from './protected-actions';
import type { FeedPager, RegistryCar } from './registry';

export interface Competition {
  id: string;
  kind: 'weekly' | 'monthly';
  title: string;
  description: string;
  opensAt: number;
  closesAt: number;
  status: string;
  winnerId?: string | null;
  submissionEnabled?: boolean;
  entryCount?: number;
  maxEntries?: number;
  results?: { eligible: boolean }[];
}

export function pastCompetitions(items: Competition[], kind: Competition['kind'], now = Date.now()): Competition[] {
  return items.filter(item => item.kind === kind && item.status === 'archived' && item.closesAt <= now &&
    item.results?.some(result => result.eligible));
}

export function watchRankedCompetitionAvailability(
  kind: Competition['kind'], receive: (available: boolean) => void, fail: (error: Error) => void,
): () => void {
  return onSnapshot(query(collection(db, 'graffiti_cars'),
    where('competitionKind', '==', kind), where('competitionVotes', '>', 0),
    where('status', 'in', ['departed', 'hall_of_fame', 'museum']),
    orderBy('competitionVotes', 'desc'), orderBy('createdAt'), orderBy(documentId()), limit(1)),
  snapshot => receive(!snapshot.empty), fail);
}

export function watchCompetitions(
  receive: (competitions: Competition[]) => void,
  fail: (error: Error) => void,
): () => void {
  return onSnapshot(collection(db, 'graffiti_competitions'), snapshot => {
    receive(snapshot.docs.map(document => ({ ...document.data(), id: document.id } as Competition))
      .sort((a, b) => b.opensAt - a.opensAt));
  }, fail);
}

export async function competitionEntries(id: string): Promise<RegistryCar[]> {
  const snapshot = await getDocs(query(collection(db, 'graffiti_cars'), where('competitionId', '==', id),
    orderBy('competitionVotes', 'desc'), orderBy('createdAt'), orderBy(documentId()), limit(30)));
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id } as RegistryCar))
    .filter(car => ['departed', 'hall_of_fame', 'museum'].includes(car.status))
    .sort((a, b) => (b.competitionVotes ?? 0) - (a.competitionVotes ?? 0) ||
      a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

export function competitionPager(id: string | null, division?: 'freight' | 'subway', uid?: string, kind?: Competition['kind']): FeedPager {
  let cursor: QueryDocumentSnapshot | undefined;
  let done = false;
  let loaded = 0;
  const maximum = id === null ? 500 : 1000;
  return {
    get done() { return done; },
    async next(count) {
      const cars: RegistryCar[] = [];
      while (!done && cars.length < count) {
        const pageSize = Math.min(count - cars.length, maximum - loaded);
        const snapshot = await getDocs(query(collection(db, 'graffiti_cars'),
          ...(id === null ? [
            where('competitionVotes', '>', 0),
            ...(kind ? [where('competitionKind', '==', kind)] : []),
            where('status', 'in', ['departed', 'hall_of_fame', 'museum']),
          ] : [where('competitionId', '==', id)]),
          ...(division ? [where('division', '==', division)] : []),
          ...(uid ? [where('writerUid', '==', uid)] : []),
          orderBy('competitionVotes', 'desc'), orderBy('createdAt'), orderBy(documentId()),
          ...(cursor ? [startAfter(cursor)] : []), limit(pageSize)));
        cursor = snapshot.docs.at(-1) ?? cursor;
        loaded += snapshot.size;
        done = snapshot.size < pageSize || loaded >= maximum;
        cars.push(...snapshot.docs.map(document => ({ ...document.data(), id: document.id } as RegistryCar))
          .filter(car => ['departed', 'hall_of_fame', 'museum'].includes(car.status)));
      }
      return cars;
    },
  };
}

export async function hasCompetitionEntry(competitionId: string, uid: string): Promise<boolean> {
  const snapshot = await getDocs(query(collection(db, 'graffiti_cars'),
    where('competitionId', '==', competitionId), where('writerUid', '==', uid), limit(1)));
  return !snapshot.empty;
}

export function watchCompetitionEntries(
  id: string, receive: (cars: RegistryCar[]) => void, fail: (error: Error) => void,
): () => void {
  return onSnapshot(query(collection(db, 'graffiti_cars'), where('competitionId', '==', id),
    orderBy('competitionVotes', 'desc'), orderBy('createdAt'), limit(30)), snapshot => {
    receive(snapshot.docs.map(document => ({ ...document.data(), id: document.id } as RegistryCar)));
  }, fail);
}

export function submitCompetition(
  competitionId: string,
  artwork: Pick<RegistryCar, 'yard' | 'division' | 'slot' | 'writer' | 'image'>,
): Promise<{ id: string }> {
  requireAbuseProtection();
  return httpsCallable<typeof artwork & { competitionId: string }, { id: string }>(
    graffitiFunctions, 'competitionSubmit',
  )({ ...artwork, competitionId }).then(result => result.data);
}

export function voteCompetition(id: string): Promise<{ votes: number; already: boolean }> {
  requireAbuseProtection();
  return httpsCallable<{ id: string }, { votes: number; already: boolean }>(
    graffitiFunctions, 'competitionVote',
  )({ id }).then(result => result.data);
}

export const competitionOpen = (competition: Competition, now = Date.now()): boolean =>
  competition.opensAt <= now && now < competition.closesAt && competition.status === 'open';

export function competitionDeadline(competition: Competition): string {
  return new Date(competition.closesAt).toLocaleString(undefined, {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) + ' US Central';
}

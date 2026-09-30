import {
  limitToLast,
  onValue,
  push,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Unsubscribe,
} from 'firebase/database';
import { rtdb } from './firebase';

export interface JunkWriter {
  uid: string;
  displayName: string;
}

export interface JunkCarState {
  currentWriter: JunkWriter | null;
  sessionEnds: number | null;
  queue: JunkWriter[];
}

export interface CarChatMsg {
  id: string;
  uid: string;
  name: string;
  text: string;
  at: number;
}

export const JUNK_QUEUE_MAX = 99;
export const JUNK_SESSION_MS = 90_000;
export const CHAT_MAX = 140;

// Live, ephemeral car state: yards/{yardKey}/cars/{carId} (line + chat). Never archived.
const carPath = (yardKey: string, carId: number) => `yards/${yardKey}/cars/${carId}`;

// Server clock offset keeps session deadlines consistent across devices.
let serverOffset = 0;
onValue(ref(rtdb, '.info/serverTimeOffset'), (s) => {
  serverOffset = Number(s.val()) || 0;
});
export const serverNow = () => Date.now() + serverOffset;

// RTDB stores arrays as objects once holes appear; normalise either shape.
function toWriters(v: unknown): JunkWriter[] {
  const list = Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : [];
  return list.filter((w): w is JunkWriter => !!w && typeof (w as JunkWriter).uid === 'string');
}

type RawCar = { currentWriter?: JunkWriter | null; sessionEnds?: number | null; queue?: unknown; chat?: unknown } | null;

export function watchJunkCar(yardKey: string, carId: number, onData: (s: JunkCarState) => void): Unsubscribe {
  const base = carPath(yardKey, carId);
  const state: JunkCarState = { currentWriter: null, sessionEnds: null, queue: [] };
  const emit = () => onData({ ...state, queue: [...state.queue] });
  const subs = [
    onValue(ref(rtdb, `${base}/currentWriter`), (s) => {
      state.currentWriter = (s.val() as JunkWriter | null) ?? null;
      emit();
    }),
    onValue(ref(rtdb, `${base}/sessionEnds`), (s) => {
      state.sessionEnds = (s.val() as number | null) ?? null;
      emit();
    }),
    onValue(ref(rtdb, `${base}/queue`), (s) => {
      state.queue = toWriters(s.val());
      emit();
    }),
  ];
  return () => subs.forEach((u) => u());
}

// Takes the car if it's open, otherwise joins the back of the line (max 99).
export async function joinJunkCar(yardKey: string, carId: number, me: JunkWriter): Promise<'writer' | 'queued' | 'full'> {
  let full = false;
  const res = await runTransaction(ref(rtdb, carPath(yardKey, carId)), (raw: RawCar) => {
    const cur = raw ?? {};
    const queue = toWriters(cur.queue).filter((w) => w.uid !== me.uid);
    if (!cur.currentWriter) {
      return { ...cur, currentWriter: me, sessionEnds: serverNow() + JUNK_SESSION_MS, queue };
    }
    if (cur.currentWriter.uid === me.uid) return cur;
    if (queue.length >= JUNK_QUEUE_MAX) {
      full = true;
      return undefined;
    }
    return { ...cur, queue: [...queue, me] };
  });
  if (full) return 'full';
  const v = res.snapshot.val() as RawCar;
  return v?.currentWriter?.uid === me.uid ? 'writer' : 'queued';
}

export async function leaveJunkLine(yardKey: string, carId: number, uid: string): Promise<void> {
  await runTransaction(ref(rtdb, `${carPath(yardKey, carId)}/queue`), (raw: unknown) => {
    const queue = toWriters(raw);
    const next = queue.filter((w) => w.uid !== uid);
    return next.length === queue.length ? undefined : next;
  });
}

// Hands the car to the next writer, but only if `expectedUid` still holds it (one caller wins).
// An empty line means the car departs: the whole live node (chat included) is deleted.
export async function advanceJunkCar(yardKey: string, carId: number, expectedUid: string): Promise<void> {
  await runTransaction(ref(rtdb, carPath(yardKey, carId)), (raw: RawCar) => {
    if (!raw || raw.currentWriter?.uid !== expectedUid) return undefined;
    const queue = toWriters(raw.queue);
    const next = queue.shift() ?? null;
    return next ? { ...raw, currentWriter: next, sessionEnds: serverNow() + JUNK_SESSION_MS, queue } : null;
  });
}

export function watchCarChat(yardKey: string, carId: number, onData: (msgs: CarChatMsg[]) => void): Unsubscribe {
  return onValue(query(ref(rtdb, `${carPath(yardKey, carId)}/chat`), limitToLast(30)), (s) => {
    const msgs: CarChatMsg[] = [];
    s.forEach((c) => {
      const v = c.val() as Omit<CarChatMsg, 'id'>;
      msgs.push({ id: c.key ?? '', uid: v.uid, name: v.name, text: v.text, at: Number(v.at) || 0 });
    });
    onData(msgs);
  });
}

export async function sendCarChat(yardKey: string, carId: number, me: JunkWriter, text: string): Promise<void> {
  const msg = push(ref(rtdb, `${carPath(yardKey, carId)}/chat`));
  await set(msg, { uid: me.uid, name: me.displayName.slice(0, 40), text: text.slice(0, CHAT_MAX), at: serverTimestamp() });
}

export function removeChatMessages(yardKey: string, carId: number, ids: string[]): Promise<void[]> {
  return Promise.all(ids.map((id) => remove(ref(rtdb, `${carPath(yardKey, carId)}/chat/${id}`))));
}

// Car pulled out / archived: drop its live node so the chat is gone for good.
export function removeCarNode(yardKey: string, carId: number): Promise<void> {
  return remove(ref(rtdb, carPath(yardKey, carId)));
}

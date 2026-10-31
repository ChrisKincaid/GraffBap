import type { User } from 'firebase/auth';
import { COMMENT_MAX, deleteComment, postComment, watchComments, type CarComment } from './services/registry';
import { reportCarComment } from './report-dialog';
import { actionError } from './services/protected-actions';

export interface WallCar {
  id: string;
  writerUid: string | null;
}

interface WallDeps {
  user(): User | null;
  // Opens the BoxBap sign-in prompt, then runs `retry` once a real account is signed in.
  requireAccount(retry: () => void): void;
  toast(message: string, ms?: number): void;
}

const REPORTED_KEY = 'graffbap_comment_reports';

const wall = document.getElementById('comment-wall') as HTMLElement;
const list = document.getElementById('cw-list') as HTMLOListElement;
const empty = document.getElementById('cw-empty') as HTMLElement;
const count = document.getElementById('cw-count') as HTMLElement;
const form = document.getElementById('cw-form') as HTMLFormElement;
const input = document.getElementById('cw-text') as HTMLTextAreaElement;
const left = document.getElementById('cw-left') as HTMLElement;
const send = document.getElementById('cw-send') as HTMLButtonElement;
const close = document.getElementById('cw-close') as HTMLButtonElement;

function reportedKey(carId: string, commentId: string, uid: string | undefined): string {
  return `${uid ?? 'guest'}|${carId}|${commentId}`;
}

function readReported(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(REPORTED_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

export function createCommentWall(deps: WallDeps) {
  let car: WallCar | null = null;
  let comments: CarComment[] = [];
  let unsubscribe: (() => void) | null = null;
  let loaded = false;
  let failed = false;
  let posting = false;
  let mobileOpen = false;
  let onCount: ((n: number | null) => void) | null = null;

  const signedIn = () => {
    const u = deps.user();
    return !!u && !u.isAnonymous;
  };

  function renderComposer(): void {
    const n = input.value.trim().length;
    left.textContent = n > COMMENT_MAX - 40 ? String(COMMENT_MAX - n) : '';
    send.disabled = posting || (signedIn() && n === 0);
    send.textContent = posting ? 'Posting...' : signedIn() ? 'Post' : 'Sign in to post';
    input.placeholder = signedIn() ? 'Say something about this piece...' : 'Sign in with BoxBap.com to comment';
  }

  function render(): void {
    const uid = deps.user()?.uid;
    const reported = readReported();
    list.replaceChildren(...comments.map((c) => {
      const li = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'cw-meta';
      const name = document.createElement('strong');
      name.textContent = c.name;
      const time = document.createElement('time');
      time.dateTime = new Date(c.at).toISOString();
      time.textContent = ago(c.at);
      time.title = new Date(c.at).toLocaleString();
      head.append(name, time);
      const canDelete = signedIn() && !!uid && (c.uid === uid || car?.writerUid === uid);
      if (canDelete) {
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'cw-del';
        del.textContent = 'Delete';
        del.title = c.uid === uid ? 'Delete your comment' : 'Delete this comment from your piece';
        del.addEventListener('click', () => void remove(c, del));
        head.append(del);
      }
      if (c.uid !== uid) {
        const flag = document.createElement('button');
        flag.type = 'button';
        flag.className = 'cw-flag';
        const done = !!car && !!reported[reportedKey(car.id, c.id, uid)];
        flag.textContent = done ? 'Reported' : 'Report';
        flag.disabled = done;
        flag.title = done ? 'Already reported' : 'Report this comment to moderators';
        flag.addEventListener('click', () => void report(c));
        head.append(flag);
      }
      const text = document.createElement('p');
      text.textContent = c.text;
      li.append(head, text);
      return li;
    }));
    empty.hidden = !loaded || comments.length > 0;
    empty.textContent = failed ? 'Comments could not load right now.' : 'No words yet. Drop the first one.';
    count.textContent = loaded && comments.length ? String(comments.length >= 50 ? '50+' : comments.length) : '';
    onCount?.(loaded ? comments.length : null);
    renderComposer();
  }

  async function remove(c: CarComment, btn: HTMLButtonElement): Promise<void> {
    if (!car || !window.confirm('Delete this comment?')) return;
    btn.disabled = true;
    const carId = car.id;
    const before = comments;
    comments = comments.filter((x) => x.id !== c.id);
    render();
    try {
      await deleteComment(carId, c.id);
    } catch (err) {
      console.error('Comment delete failed', err);
      if (car?.id === carId) {
        comments = before;
        render();
      }
      deps.toast(actionError(err), 6000);
    }
  }

  async function report(c: CarComment): Promise<void> {
    if (!car) return;
    const carId = car.id;
    const result = await reportCarComment(carId, c.id);
    if (!result) return;
    const reported = readReported();
    reported[reportedKey(carId, c.id, deps.user()?.uid)] = true;
    try {
      localStorage.setItem(REPORTED_KEY, JSON.stringify(reported));
    } catch (err) {
      console.warn('Report sent, but this browser could not remember it locally.', err);
    }
    deps.toast(result === 'already' ? 'You already reported that comment.' : 'Comment reported. Moderators will take a look.');
    render();
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void submit();
  });
  input.addEventListener('input', renderComposer);
  input.addEventListener('keydown', (ev) => {
    // Enter posts; Shift+Enter keeps typing on a new line.
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void submit();
    }
  });
  input.addEventListener('focus', () => {
    if (!signedIn()) {
      input.blur();
      deps.requireAccount(() => input.focus());
    }
  });
  close.addEventListener('click', () => setMobileOpen(false));

  async function submit(): Promise<void> {
    if (!car || posting) return;
    if (!signedIn()) {
      deps.requireAccount(() => input.focus());
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    const carId = car.id;
    posting = true;
    renderComposer();
    try {
      const posted = await postComment(carId, text);
      if (car?.id === carId) {
        input.value = '';
        if (!comments.some((c) => c.id === posted.id)) comments = [posted, ...comments];
        render();
      }
    } catch (err) {
      console.error('Comment failed', err);
      deps.toast(actionError(err), 6000);
    } finally {
      posting = false;
      renderComposer();
    }
  }

  function setMobileOpen(open: boolean): void {
    mobileOpen = open;
    wall.classList.toggle('is-open', open);
    if (open) input.blur();
  }

  return {
    // Shows the wall for a published piece, or hides it when `next` is null.
    show(next: WallCar | null): void {
      if (next?.id === car?.id) {
        if (next) car = next;
        render();
        return;
      }
      unsubscribe?.();
      unsubscribe = null;
      car = next;
      comments = [];
      loaded = false;
      failed = false;
      if (!next) setMobileOpen(false);
      wall.hidden = !next;
      if (next) {
        input.value = '';
        unsubscribe = watchComments(next.id, (items) => {
          if (car?.id !== next.id) return;
          comments = items;
          loaded = true;
          failed = false;
          render();
        }, (err) => {
          console.error('Comments failed to load', err);
          if (car?.id !== next.id) return;
          loaded = true;
          failed = true;
          render();
        });
      }
      render();
    },
    openMobile: () => setMobileOpen(true),
    get mobileOpen() {
      return mobileOpen;
    },
    get element() {
      return wall;
    },
    onCountChange(cb: (n: number | null) => void): void {
      onCount = cb;
    },
    refresh: render,
  };
}

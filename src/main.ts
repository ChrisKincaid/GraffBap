import './style.css';
import {
  playPeel,
  playPuff,
  playShake,
  playSqueak,
  setClatterRate,
  setMuted,
  startClatter,
  startHiss,
  stopClatter,
  stopHiss,
} from './audio';
import { drawBackdrop, GROUND_Y, seededRandom } from './backdrop';
import {
  countPainting,
  getRegistryCar,
  isBeingPainted,
  listFeed,
  listMine,
  registerDeparture,
  reportRegistryCar,
  retirePiece,
  updatePieceImage,
  voteRegistryCar,
  type FeedSort,
  type RegistryCar,
} from './services/registry';
import boxbapLogoUrl from '../Images/BoxBapLogoSm.png';
import { updateProfile } from 'firebase/auth';
import { deleteLocalCars, loadLocalCar, saveLocalCar } from './localStore';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  auth,
  ensureAnonymous,
  registerWithEmail,
  signInWithEmail,
  signInWithGithub,
  signInWithGoogle,
  signOutUser,
} from './services/firebase';

const CAR_WIDTH = 4000;
const CAR_HEIGHT = 1200;

const MIN_SCALE = 0.05;
const MAX_SCALE = 5.0;

// Paintable car body side panel, in car-space pixels.
const BODY = { x: 90, y: 180, w: 3820, h: 780 };
const RIB_SPACING = 120;
const DOOR = { x: 1650, y: 195, w: 700, h: 760 };

const viewport = document.getElementById('viewport') as HTMLCanvasElement;
const viewCtx = viewport.getContext('2d')!;

function makeLayer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = CAR_WIDTH;
  c.height = CAR_HEIGHT;
  return [c, c.getContext('2d')!];
}

const [bgLayer, bgCtx] = makeLayer();
const [paintLayer, paintCtx] = makeLayer();
const [fgLayer, fgCtx] = makeLayer();

// ---------- Background: boxcar silhouette ----------
function drawBackground(ctx: CanvasRenderingContext2D, v: CarVariant): void {
  // Sky, ballast and rails are drawn per-frame by the yard backdrop.

  // Couplers
  ctx.fillStyle = '#1e1e1e';
  for (const [x, dir] of [[BODY.x, -1], [BODY.x + BODY.w, 1]] as const) {
    ctx.fillRect(dir < 0 ? x - 70 : x, 968, 70, 26);
    ctx.fillRect(dir < 0 ? x - 95 : x + 55, 955, 40, 52);
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(dir < 0 ? x - 90 : x + 60, 962, 30, 38);
    ctx.fillStyle = '#1e1e1e';
  }

  // Trucks and wheels
  for (const cx of [520, CAR_WIDTH - 520]) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - 260, 1000, 520, 70);
    for (const wx of [cx - 160, cx + 160]) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(wx, 1070, 72, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3b3b3b';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath();
      ctx.arc(wx, 1070, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#242424';
    ctx.fillRect(cx - 200, 1030, 400, 40);
  }

  // Side sill
  ctx.fillStyle = '#26282b';
  ctx.fillRect(BODY.x, BODY.y + BODY.h, BODY.w, 42);

  // Body panel base
  ctx.fillStyle = v.color;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);

  // Corrugated vertical ribs
  for (let x = BODY.x + RIB_SPACING / 2; x < BODY.x + BODY.w - 20; x += RIB_SPACING) {
    const g = ctx.createLinearGradient(x - 22, 0, x + 22, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 22, BODY.y, 44, BODY.h);
  }

  // Door panel
  ctx.fillStyle = v.color;
  ctx.fillRect(DOOR.x, DOOR.y, DOOR.w, DOOR.h);
  if (v.door === 'plug') {
    const g = ctx.createLinearGradient(DOOR.x, 0, DOOR.x + DOOR.w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = g;
    ctx.fillRect(DOOR.x, DOOR.y, DOOR.w, DOOR.h);
  } else {
    for (let y = DOOR.y + 34; y < DOOR.y + DOOR.h - 20; y += 64) {
      const g = ctx.createLinearGradient(0, y - 18, 0, y + 18);
      g.addColorStop(0, 'rgba(0,0,0,0.25)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.14)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = g;
      ctx.fillRect(DOOR.x, y - 18, DOOR.w, 36);
    }
  }

  // Reporting marks and weight stencils, left end of the car.
  const mx = BODY.x + 170;
  const my = BODY.y + 130;
  ctx.save();
  ctx.fillStyle = v.ink;
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.85;
  ctx.font = 'bold 84px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
  ctx.fillText(v.mark, mx, my);
  ctx.fillText(v.number, mx, my + 96);
  ctx.globalAlpha = 0.5;
  ctx.font = '600 28px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
  ctx.fillText(`LT WT ${v.ltWt}`, mx, my + 210);
  ctx.fillText(`LD LMT ${v.ldLmt}`, mx, my + 246);
  ctx.fillText(v.built, mx, my + 282);
  ctx.restore();

  // Weathering grime toward the bottom
  const grime = ctx.createLinearGradient(0, BODY.y, 0, BODY.y + BODY.h);
  grime.addColorStop(0, 'rgba(0,0,0,0)');
  grime.addColorStop(1, 'rgba(20,12,6,0.35)');
  ctx.fillStyle = grime;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);

  // Roof lip
  ctx.fillStyle = '#1f2023';
  ctx.fillRect(BODY.x - 20, BODY.y - 34, BODY.w + 40, 40);
  ctx.fillStyle = '#34363a';
  ctx.fillRect(BODY.x - 20, BODY.y - 34, BODY.w + 40, 6);
}

// ---------- Foreground: trim, shading, rivets over paint ----------
function rivet(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(x + 1.5, y + 1.5, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a5552';
  ctx.beginPath();
  ctx.arc(x, y, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - 1.5, y - 1.5, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawForeground(ctx: CanvasRenderingContext2D, v: CarVariant): void {
  // Rib shadow seams so paint follows the corrugation
  for (let x = BODY.x + RIB_SPACING / 2; x < BODY.x + BODY.w - 20; x += RIB_SPACING) {
    if (x > DOOR.x - 25 && x < DOOR.x + DOOR.w + 25) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + 18, BODY.y, 4, BODY.h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x - 14, BODY.y, 3, BODY.h);
  }

  // Door frame and tracks
  ctx.strokeStyle = 'rgba(15,15,15,0.85)';
  ctx.lineWidth = 8;
  ctx.strokeRect(DOOR.x, DOOR.y, DOOR.w, DOOR.h);
  ctx.fillStyle = '#1c1c1e';
  ctx.fillRect(DOOR.x - 120, DOOR.y - 14, DOOR.w + 240, 14);
  ctx.fillRect(DOOR.x - 120, DOOR.y + DOOR.h - 4, DOOR.w + 240, 14);

  if (v.door === 'plug') {
    // Full-height locking bars with keeper brackets.
    for (const bx of [DOOR.x + 60, DOOR.x + 180, DOOR.x + DOOR.w - 194, DOOR.x + DOOR.w - 74]) {
      ctx.fillStyle = '#2a2a2c';
      ctx.fillRect(bx, DOOR.y + 20, 14, DOOR.h - 40);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(bx, DOOR.y + 20, 3, DOOR.h - 40);
      ctx.fillStyle = '#1a1a1c';
      for (let y = DOOR.y + 60; y < DOOR.y + DOOR.h - 40; y += 180) ctx.fillRect(bx - 8, y, 30, 16);
    }
  } else {
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(DOOR.x + DOOR.w / 2, DOOR.y);
    ctx.lineTo(DOOR.x + DOOR.w / 2, DOOR.y + DOOR.h);
    ctx.stroke();
    ctx.fillStyle = '#2a2a2c';
    ctx.fillRect(DOOR.x + 40, DOOR.y + 300, 14, 180);
    ctx.fillRect(DOOR.x + DOOR.w - 54, DOOR.y + 300, 14, 180);
  }

  // Top/bottom panel seams
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(BODY.x, BODY.y, BODY.w, 4);
  ctx.fillRect(BODY.x, BODY.y + BODY.h - 4, BODY.w, 4);

  // Rivet rows
  for (let x = BODY.x + 20; x < BODY.x + BODY.w; x += 40) {
    rivet(ctx, x, BODY.y + 16);
    rivet(ctx, x, BODY.y + BODY.h - 16);
  }
  for (let y = DOOR.y + 30; y < DOOR.y + DOOR.h - 20; y += 45) {
    rivet(ctx, DOOR.x + 16, y);
    rivet(ctx, DOOR.x + DOOR.w - 16, y);
  }
  for (const x of [BODY.x + 14, BODY.x + BODY.w - 14]) {
    for (let y = BODY.y + 40; y < BODY.y + BODY.h - 30; y += 45) rivet(ctx, x, y);
  }
}

// ---------- Weathering: grime (multiply) and sheen (soft-light) composited over paint ----------
const WEATHER = { x: BODY.x - 30, y: BODY.y - 40, w: BODY.w + 60, h: BODY.h + 100 };

function makeWeatherLayer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = WEATHER.w;
  c.height = WEATHER.h;
  const ctx = c.getContext('2d')!;
  ctx.translate(-WEATHER.x, -WEATHER.y);
  return [c, ctx];
}

const [grimeLayer, grimeCtx] = makeWeatherLayer();
const [sheenLayer, sheenCtx] = makeWeatherLayer();

function drawGrime(ctx: CanvasRenderingContext2D): void {
  const r = seededRandom(3);
  const bottom = BODY.y + BODY.h;

  const low = ctx.createLinearGradient(0, bottom - BODY.h * 0.35, 0, bottom + 40);
  low.addColorStop(0, 'rgba(70,48,30,0)');
  low.addColorStop(1, 'rgba(70,48,30,0.6)');
  ctx.fillStyle = low;
  ctx.fillRect(WEATHER.x, bottom - BODY.h * 0.35, WEATHER.w, BODY.h * 0.35 + 60);

  for (const cx of [520, CAR_WIDTH - 520]) {
    const t = ctx.createRadialGradient(cx, bottom + 30, 0, cx, bottom + 30, 520);
    t.addColorStop(0, 'rgba(45,30,20,0.7)');
    t.addColorStop(1, 'rgba(45,30,20,0)');
    ctx.fillStyle = t;
    ctx.fillRect(cx - 520, bottom - 490, 1040, 560);
  }

  ctx.fillStyle = 'rgba(55,38,26,0.35)';
  ctx.fillRect(BODY.x, BODY.y, BODY.w, 14);
  ctx.fillRect(BODY.x, bottom - 18, BODY.w, 18);

  // Rust weeping down from the top rivet line.
  for (let i = 0; i < 70; i++) {
    const x = BODY.x + r() * BODY.w;
    const y = BODY.y + 10 + r() * 10;
    const len = 60 + r() * 320;
    const s = ctx.createLinearGradient(0, y, 0, y + len);
    s.addColorStop(0, `rgba(140,70,30,${0.35 + r() * 0.3})`);
    s.addColorStop(1, 'rgba(140,70,30,0)');
    ctx.fillStyle = s;
    ctx.fillRect(x, y, 2 + r() * 9, len);
  }

  for (let i = 0; i < 45; i++) {
    const x = BODY.x + r() * BODY.w;
    const y = BODY.y + BODY.h * (0.4 + r() * 0.6);
    const rad = 15 + r() * 70;
    const b = ctx.createRadialGradient(x, y, 0, x, y, rad);
    b.addColorStop(0, `rgba(130,62,28,${0.25 + r() * 0.3})`);
    b.addColorStop(1, 'rgba(130,62,28,0)');
    ctx.fillStyle = b;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  for (let i = 0; i < 7000; i++) {
    const v = 40 + r() * 50;
    const s = 1 + r() * 3;
    ctx.fillStyle = `rgba(${v + 20},${v},${v - 15},${0.08 + r() * 0.25})`;
    ctx.fillRect(BODY.x + r() * BODY.w, BODY.y + r() * BODY.h, s, s);
  }
}

function drawSheen(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(BODY.x, BODY.y, BODY.w, BODY.h);
  ctx.clip();

  const v = ctx.createLinearGradient(0, BODY.y, 0, BODY.y + BODY.h);
  v.addColorStop(0, 'rgba(255,255,255,0.35)');
  v.addColorStop(0.45, 'rgba(255,255,255,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = v;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);

  const d = ctx.createLinearGradient(BODY.x, BODY.y, BODY.x + BODY.w, BODY.y + BODY.h);
  for (const pos of [0.12, 0.38, 0.66, 0.9]) {
    d.addColorStop(pos - 0.04, 'rgba(255,255,255,0)');
    d.addColorStop(pos, 'rgba(255,255,255,0.25)');
    d.addColorStop(pos + 0.04, 'rgba(255,255,255,0)');
  }
  ctx.fillStyle = d;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);
  ctx.restore();
}

// Vertical panel-seam rivet columns, skipping the door.
function drawSeamRivets(ctx: CanvasRenderingContext2D): void {
  for (let x = BODY.x + 480; x < BODY.x + BODY.w - 100; x += 480) {
    if (x > DOOR.x - 40 && x < DOOR.x + DOOR.w + 40) continue;
    for (let y = BODY.y + 60; y < BODY.y + BODY.h - 40; y += 60) rivet(ctx, x, y);
  }
}

// ---------- Per-car variants (deterministic by car index) ----------
interface CarVariant {
  color: string;
  ink: string;
  door: 'plug' | 'corrugated';
  mark: string;
  number: string;
  ltWt: number;
  ldLmt: number;
  built: string;
}

const CAR_PALETTE = [
  { color: '#7a3a26', ink: '#ece5d6' }, // oxide boxcar red
  { color: '#b39436', ink: '#1c1a16' }, // Railbox/TTX faded yellow
  { color: '#2f4a36', ink: '#ece5d6' }, // Cascade/forest green
  { color: '#4d6670', ink: '#f0ede4' }, // weathered industrial blue
  { color: '#8f8d86', ink: '#1e1e1e' }, // primer gray
  { color: '#4f2a2a', ink: '#e6dfd0' }, // muted maroon
];
const ROAD_MARKS = ['BAPX', 'GBAP', 'BXBP', 'BBOX', 'GRFX'];
// Stencil date comes from the session's real-world date, e.g. September 2026 -> month 9, year 26.
const STENCIL_DATE = new Date();
const STENCIL_MONTH = STENCIL_DATE.getMonth() + 1;
const STENCIL_YY = String(STENCIL_DATE.getFullYear() % 100).padStart(2, '0');

const CAR_VARIANTS: CarVariant[] = [];
for (let i = 0, prev = -1; i < 20; i++) {
  const r = seededRandom(1000 + i);
  let pick = Math.floor(r() * CAR_PALETTE.length);
  if (pick === prev) pick = (pick + 1 + Math.floor(r() * (CAR_PALETTE.length - 1))) % CAR_PALETTE.length;
  prev = pick;
  const ltWt = 60000 + Math.round(r() * 120) * 100;
  CAR_VARIANTS.push({
    ...CAR_PALETTE[pick]!,
    door: r() < 0.5 ? 'plug' : 'corrugated',
    mark: ROAD_MARKS[Math.floor(r() * ROAD_MARKS.length)]!,
    // Month + two-digit year + car number, e.g. Sept 2026 car 03 -> 92603.
    number: `${STENCIL_MONTH}${STENCIL_YY}${String(i + 1).padStart(2, '0')}`,
    ltWt,
    ldLmt: 263000 - ltWt,
    built: `BLT ${String(STENCIL_MONTH).padStart(2, '0')}-${STENCIL_YY}`,
  });
}

// Base ids: car index for freight, SUBWAY_BASE + index for the procedural subway car.
const SUBWAY_BASE = 100;

function drawCarBase(bg: CanvasRenderingContext2D, fg: CanvasRenderingContext2D, id: number): void {
  if (id >= SUBWAY_BASE) {
    drawSubwayBackground(bg, id - SUBWAY_BASE);
    drawSubwayForeground(fg);
    return;
  }
  const v = CAR_VARIANTS[id]!;
  drawBackground(bg, v);
  drawSeamRivets(fg);
  drawForeground(fg, v);
}

// ---------- Procedural subway car: fluted stainless, passenger windows, transit trucks ----------
type Rect = { x: number; y: number; w: number; h: number };
const SUB_DOOR_W = 300;
const SUB_WIN_Y = BODY.y + 130;
const SUB_WIN_H = 230;
let subwayLayoutCache: { doors: Rect[]; windows: Rect[]; doorWindows: Rect[] } | null = null;

function subwayLayout(): { doors: Rect[]; windows: Rect[]; doorWindows: Rect[] } {
  if (subwayLayoutCache) return subwayLayoutCache;
  const centers = [0.12, 0.37, 0.63, 0.88].map((f) => Math.round(BODY.x + BODY.w * f));
  const doors = centers.map((cx) => ({ x: cx - SUB_DOOR_W / 2, y: BODY.y + 40, w: SUB_DOOR_W, h: BODY.h - 40 }));
  const doorWindows = doors.flatMap((d) => [
    { x: d.x + 28, y: SUB_WIN_Y, w: 100, h: 200 },
    { x: d.x + d.w - 128, y: SUB_WIN_Y, w: 100, h: 200 },
  ]);
  const edges = [BODY.x + 40, ...doors.flatMap((d) => [d.x, d.x + d.w]), BODY.x + BODY.w - 40];
  const windows: Rect[] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i]! + 60;
    const b = edges[i + 1]! - 60;
    const n = Math.max(1, Math.floor((b - a) / 380));
    const w = (b - a - (n - 1) * 50) / n;
    for (let k = 0; k < n; k++) windows.push({ x: a + k * (w + 50), y: SUB_WIN_Y, w, h: SUB_WIN_H });
  }
  subwayLayoutCache = { doors, windows, doorWindows };
  return subwayLayoutCache;
}

function drawSubwayBackground(ctx: CanvasRenderingContext2D, index: number): void {
  const r = seededRandom(5000 + index);
  const bottom = BODY.y + BODY.h;
  // Undercarriage: equipment boxes, trucks, third-rail shoes.
  ctx.fillStyle = '#17181a';
  ctx.fillRect(BODY.x + 40, bottom, BODY.w - 80, 36);
  for (let x = BODY.x + 900; x < BODY.x + BODY.w - 1100; x += 280) {
    ctx.fillStyle = r() < 0.5 ? '#202226' : '#2a2d31';
    ctx.fillRect(x, bottom + 36, 200 + r() * 50, 50 + r() * 20);
  }
  for (const cx of [560, CAR_WIDTH - 560]) {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - 220, bottom + 36, 440, 56);
    for (const wx of [cx - 130, cx + 130]) {
      ctx.fillStyle = '#111';
      ctx.beginPath();
      ctx.arc(wx, 1070, 56, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3b3b3b';
      ctx.lineWidth = 7;
      ctx.stroke();
    }
    ctx.fillStyle = '#4a3f2c';
    ctx.fillRect(cx - 270, 1052, 44, 12);
    ctx.fillRect(cx + 226, 1052, 44, 12);
  }
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(BODY.x - 60, bottom - 40, 60, 30);
  ctx.fillRect(BODY.x + BODY.w, bottom - 40, 60, 30);

  // Brushed stainless body with vertical fluting.
  const steel = ctx.createLinearGradient(0, BODY.y, 0, bottom);
  steel.addColorStop(0, '#d7dade');
  steel.addColorStop(0.4, '#aeb3b8');
  steel.addColorStop(0.7, '#c4c8cc');
  steel.addColorStop(1, '#8d9297');
  ctx.fillStyle = steel;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);
  for (let x = BODY.x + 12; x < BODY.x + BODY.w - 8; x += 28) {
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(x, BODY.y + 20, 3, BODY.h - 40);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    ctx.fillRect(x + 11, BODY.y + 20, 4, BODY.h - 40);
  }

  const { doors, windows, doorWindows } = subwayLayout();
  for (const d of doors) {
    const g = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
    g.addColorStop(0, '#bfc3c7');
    g.addColorStop(1, '#a4a9ae');
    ctx.fillStyle = g;
    ctx.fillRect(d.x, d.y, d.w, d.h);
  }
  for (const w of [...windows, ...doorWindows]) {
    const g = ctx.createLinearGradient(w.x, w.y, w.x + w.w, w.y + w.h);
    g.addColorStop(0, '#2b333c');
    g.addColorStop(0.45, '#161b21');
    g.addColorStop(0.55, '#3a4450');
    g.addColorStop(1, '#12161b');
    ctx.fillStyle = g;
    ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  // Car number plates at both ends.
  ctx.save();
  ctx.fillStyle = '#1d1f22';
  ctx.font = 'bold 56px "Arial Narrow", Arial, sans-serif';
  ctx.textBaseline = 'top';
  const num = String(7000 + index * 2 + Math.floor(r() * 2));
  ctx.fillText(num, BODY.x + 70, BODY.y + 50);
  ctx.fillText(num, BODY.x + BODY.w - 200, BODY.y + 50);
  ctx.restore();

  const grime = ctx.createLinearGradient(0, BODY.y, 0, bottom);
  grime.addColorStop(0.6, 'rgba(0,0,0,0)');
  grime.addColorStop(1, 'rgba(30,24,18,0.35)');
  ctx.fillStyle = grime;
  ctx.fillRect(BODY.x, BODY.y, BODY.w, BODY.h);

  // Rounded roof line.
  ctx.fillStyle = '#7f858b';
  ctx.fillRect(BODY.x - 10, BODY.y - 40, BODY.w + 20, 44);
  ctx.fillStyle = '#a3a9ae';
  ctx.fillRect(BODY.x - 10, BODY.y - 40, BODY.w + 20, 8);
}

function drawSubwayForeground(ctx: CanvasRenderingContext2D): void {
  const { doors, windows, doorWindows } = subwayLayout();
  // Rubber gaskets and door seams sit over the paint, like the real thing.
  ctx.strokeStyle = '#141619';
  ctx.lineWidth = 10;
  for (const w of [...windows, ...doorWindows]) ctx.strokeRect(w.x, w.y, w.w, w.h);
  ctx.lineWidth = 6;
  for (const d of doors) {
    ctx.strokeRect(d.x, d.y, d.w, d.h);
    ctx.beginPath();
    ctx.moveTo(d.x + d.w / 2, d.y);
    ctx.lineTo(d.x + d.w / 2, d.y + d.h);
    ctx.stroke();
    ctx.fillStyle = '#9aa0a6';
    ctx.fillRect(d.x - 26, d.y + 260, 8, 200);
    ctx.fillRect(d.x + d.w + 18, d.y + 260, 8, 200);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(BODY.x, BODY.y, BODY.w, 4);
  ctx.fillRect(BODY.x, BODY.y + BODY.h - 4, BODY.w, 4);
}

const baseIdFor = (yard: YardId | 'preset', index: number) =>
  yard !== 'preset' && YARDS[yard].division === 'subway' ? SUBWAY_BASE + index : index;

// Presets stand in on both reels, so the body they wear depends on the reel they're rolling on.
const entryBaseId = (e: { yard: YardId | 'preset'; index: number; sub?: boolean }) =>
  e.yard === 'preset' && e.sub ? SUBWAY_BASE + e.index : baseIdFor(e.yard, e.index);

// bgLayer/fgLayer always hold the full-res base for this car index.
let baseIndex = 0;

function applyCarBase(index: number): void {
  if (index === baseIndex) return;
  baseIndex = index;
  bgCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  fgCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  drawCarBase(bgCtx, fgCtx, index);
  dirty = true;
}

// Reduced-size bases for Roll-By and train export; cleared when those finish.
const BASE_CACHE_SCALE = 0.35;
const baseCache = new Map<number, { bg: HTMLCanvasElement; fg: HTMLCanvasElement }>();

function carBase(index: number): { bg: CanvasImageSource; fg: CanvasImageSource } {
  if (index === baseIndex) return { bg: bgLayer, fg: fgLayer };
  let b = baseCache.get(index);
  if (!b) {
    const make = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const c = document.createElement('canvas');
      c.width = Math.round(CAR_WIDTH * BASE_CACHE_SCALE);
      c.height = Math.round(CAR_HEIGHT * BASE_CACHE_SCALE);
      const ctx = c.getContext('2d')!;
      ctx.scale(BASE_CACHE_SCALE, BASE_CACHE_SCALE);
      return [c, ctx];
    };
    const [bg, bgc] = make();
    const [fg, fgc] = make();
    drawCarBase(bgc, fgc, index);
    b = { bg, fg };
    baseCache.set(index, b);
  }
  return b;
}

drawGrime(grimeCtx);
drawSheen(sheenCtx);
drawCarBase(bgCtx, fgCtx, 0);

// In-progress roller stroke, composited once so overlapping stamps don't stack opacity.
const [strokeLayer, strokeCtx] = makeLayer();
// Chalk guides for the current car: shown in the editor only, never saved or exported.
const [sketchLayer, sketchCtx] = makeLayer();
let sketchMode = false;
let sketchHas = false;
let flashlight = false;

// Paint only lands on the car body.
for (const ctx of [paintCtx, strokeCtx, sketchCtx]) {
  ctx.beginPath();
  ctx.rect(BODY.x, BODY.y, BODY.w, BODY.h);
  ctx.clip();
}

// ---------- Consist & history ----------
const CAR_COUNT = 20;
const HISTORY_LIMIT = 10;

// Body-region snapshot; compressed to PNG in the background so 20 cars fit in memory.
interface Snapshot {
  canvas: HTMLCanvasElement | null;
  blob: Promise<Blob | null>;
  // Warm snapshots keep their live canvas so switching back is instant.
  keep: boolean;
  // Car's hasPaint at capture time, so undo/redo can restore the hit indicator.
  hasPaint?: boolean;
}

interface Car {
  paint: Snapshot | null;
  undo: Snapshot[];
  redo: Snapshot[];
  remoteState: 'none' | 'loading' | 'done';
  localState: 'none' | 'loading' | 'done';
  hasPaint: boolean;
  sketch: HTMLCanvasElement | null;
  // Bumped on every local edit so late network loads don't clobber newer paint.
  version: number;
}

const makeConsist = (): Car[] =>
  Array.from({ length: CAR_COUNT }, () => ({
    paint: null,
    undo: [],
    redo: [],
    remoteState: 'none' as Car['remoteState'],
    localState: 'none' as Car['localState'],
    hasPaint: false,
    sketch: null as HTMLCanvasElement | null,
    version: 0,
  }));

type YardId = 'train' | 'subway';
type Division = 'freight' | 'subway';
interface YardRules {
  // Seconds of continuous spraying a full can holds.
  gauge: number;
}
const RULES: YardRules = { gauge: 45 };
interface YardDef {
  label: string;
  rules: YardRules;
  division: Division;
}
const YARDS: Record<YardId, YardDef> = {
  train: { label: 'Train', rules: RULES, division: 'freight' },
  subway: { label: 'Subway', rules: RULES, division: 'subway' },
};
const surfaceFor = (division: string): YardId => (division === 'subway' ? 'subway' : 'train');
const yardConsists = Object.fromEntries(Object.keys(YARDS).map((id) => [id, makeConsist()])) as Record<YardId, Car[]>;

// Survives a reload so refreshing inside a surface keeps the same surface and practice flag.
const SESSION_KEY = 'graffbap_session';
interface YardSession {
  yard: YardId;
  practice: boolean;
}
function recallSession(): YardSession | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (!v || typeof v !== 'object') return null;
    const { yard, practice } = v as Record<string, unknown>;
    return typeof yard === 'string' && yard in YARDS ? { yard: yard as YardId, practice: practice === true } : null;
  } catch {
    return null;
  }
}
function rememberSession(yard: YardId, practice: boolean): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ yard, practice }));
}

let currentYard: YardId = 'train';
let consist = yardConsists.train;
let currentCarIndex = 0;
// Restored before the first car loads, so a refresh in practice never reads old paint off disk.
let practiceMode = location.hash === '#yard' && recallSession()?.practice === true;
// True while an async undo/redo restore owns the paint layer.
let busy = false;
// True while the target car's compressed buffer is decoding after a switch.
let swapPending = false;
let swapToken = 0;
const car = () => consist[currentCarIndex]!;
const locked = () => busy || swapPending;

// Accepts either a full 4000x1200 source or an already body-sized one.
function copyBody(source: HTMLCanvasElement | HTMLImageElement = paintLayer): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = BODY.w;
  c.height = BODY.h;
  const ctx = c.getContext('2d')!;
  if (source.width === BODY.w) ctx.drawImage(source, 0, 0);
  else ctx.drawImage(source, BODY.x, BODY.y, BODY.w, BODY.h, 0, 0, BODY.w, BODY.h);
  return c;
}

function snapshot(source: HTMLCanvasElement | HTMLImageElement = paintLayer, keep = false): Snapshot {
  const c = copyBody(source);
  const snap: Snapshot = { canvas: c, blob: Promise.resolve(null), keep };
  snap.blob = new Promise((resolve) =>
    c.toBlob((b) => {
      if (b && !snap.keep) snap.canvas = null;
      resolve(b);
    }, 'image/png'),
  );
  return snap;
}

const WARM_CARS = 3;
const warm: Car[] = [];

function keepWarm(c: Car): void {
  const i = warm.indexOf(c);
  if (i >= 0) warm.splice(i, 1);
  warm.push(c);
  while (warm.length > WARM_CARS) {
    const s = warm.shift()!.paint;
    if (!s) continue;
    s.keep = false;
    s.blob.then((b) => {
      if (b && !s.keep) s.canvas = null;
    });
  }
}

async function drawSnapshot(s: Snapshot | null): Promise<void> {
  let src: CanvasImageSource | null = s?.canvas ?? null;
  if (s && !src) {
    const b = await s.blob;
    if (b) src = await createImageBitmap(b);
  }
  paintCtx.globalAlpha = 1;
  paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  if (src) paintCtx.drawImage(src, BODY.x, BODY.y);
  dirty = true;
}

async function runBusy(task: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  updateConsistUI();
  updateHistoryButtons();
  try {
    await task();
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
    updateConsistUI();
    updateHistoryButtons();
  }
}

function historySnap(c: Car): Snapshot {
  const s = snapshot();
  s.hasPaint = c.hasPaint;
  return s;
}

// Downscaled alpha scan; cheap enough to run once per remote load.
function hasVisiblePaint(src: HTMLImageElement | HTMLCanvasElement): boolean {
  const w = Math.ceil(BODY.w / 10);
  const h = Math.ceil(BODY.h / 10);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  if (src.width === BODY.w) ctx.drawImage(src, 0, 0, w, h);
  else ctx.drawImage(src, BODY.x, BODY.y, BODY.w, BODY.h, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
  return false;
}

function pushHistory(): void {
  finishDrips();
  const c = car();
  c.version++;
  c.undo.push(historySnap(c));
  if (c.undo.length > HISTORY_LIMIT) c.undo.shift();
  c.redo.length = 0;
  updateHistoryButtons();
}

function undo(): void {
  const c = car();
  if (mode !== 'none' || locked() || !c.undo.length) return;
  finishDrips();
  glazes.length = 0;
  c.version++;
  c.redo.push(historySnap(c));
  const s = c.undo.pop()!;
  c.hasPaint = s.hasPaint ?? false;
  updateConsistUI();
  runBusy(async () => {
    await drawSnapshot(s);
    scheduleSave();
  });
}

function redo(): void {
  const c = car();
  if (mode !== 'none' || locked() || !c.redo.length) return;
  finishDrips();
  glazes.length = 0;
  c.version++;
  c.undo.push(historySnap(c));
  const s = c.redo.pop()!;
  c.hasPaint = s.hasPaint ?? false;
  updateConsistUI();
  runBusy(async () => {
    await drawSnapshot(s);
    scheduleSave();
  });
}

// Stores the active car's paint without blocking; compression and saving continue in the background.
function leaveCar(): void {
  finishDrips();
  glazes.length = 0;
  car().sketch = sketchHas ? copyBody(sketchLayer) : null;
  // While a previous swap is still decoding, the canvas doesn't hold that car's paint yet.
  if (swapPending) return;
  const c = car();
  const snap = snapshot(paintLayer, true);
  c.paint = snap;
  keepWarm(c);
  flushSave(snap.canvas!);
}

function enterCar(): void {
  const token = ++swapToken;
  applyCarBase(baseIdFor(currentYard, currentCarIndex));
  sketchCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  const sk = car().sketch;
  if (sk) sketchCtx.drawImage(sk, BODY.x, BODY.y);
  sketchHas = !!sk;
  paintCtx.globalAlpha = 1;
  paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  dirty = true;

  const target = car().paint;
  if (target?.canvas) {
    paintCtx.drawImage(target.canvas, BODY.x, BODY.y);
    keepWarm(car());
  }
  if (!target || target.canvas) {
    finishSwap(token);
    return;
  }

  swapPending = true;
  updateConsistUI();
  updateHistoryButtons();
  target.blob
    .then((b) => (b ? createImageBitmap(b) : null))
    .then((bmp) => {
      if (token !== swapToken) return;
      if (bmp) paintCtx.drawImage(bmp, BODY.x, BODY.y);
      dirty = true;
      finishSwap(token);
    })
    .catch((err) => {
      console.error('Car buffer decode failed', err);
      finishSwap(token);
    });
}

function switchCar(index: number): void {
  if (index < 0 || index >= CAR_COUNT || index === currentCarIndex || mode !== 'none' || busy) return;
  leaveCar();
  currentCarIndex = index;
  enterCar();
}

function switchYard(id: YardId): void {
  if (id === currentYard || mode !== 'none' || busy) return;
  leaveCar();
  currentYard = id;
  consist = yardConsists[id];
  if (location.hash === '#yard') rememberSession(id, practiceMode);
  saveStatus.textContent = '';
  resetPieceSession();
  enterCar();
  resetYardSession();
}

function finishSwap(token: number): void {
  if (token !== swapToken) return;
  swapPending = false;
  updateConsistUI();
  updateHistoryButtons();
  void fetchLocal(currentYard, currentCarIndex);
}

// ---------- Brush state ----------
type Tool = 'spray' | 'roller' | 'paintball' | 'mop' | 'chisel' | 'buff';
type Cap = 'fat' | 'skinny';
type RollerPreset = 'standard' | 'wide';
const brush = {
  size: 40,
  hardness: 0.2,
  opacity: 0.8,
  color: '#ffffff',
  tool: 'spray' as Tool,
  cap: 'fat' as Cap,
  roller: 'standard' as RollerPreset,
};
let stamp = document.createElement('canvas');

// Fat cap: wide dusty flare. Skinny cap: tight, hard core with little overspray.
const sprayDiameter = () => brush.size * (brush.cap === 'fat' ? 1.5 : 0.7);
const sprayHardness = () => (brush.cap === 'fat' ? brush.hardness * 0.4 : 0.55 + brush.hardness * 0.45);

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rebuildStamp(): void {
  const d = Math.max(2, Math.ceil(sprayDiameter()));
  const r = d / 2;
  const c = document.createElement('canvas');
  c.width = c.height = d;
  const ctx = c.getContext('2d')!;
  const [R, G, B] = hexToRgb(brush.color);
  const col = (a: number) => `rgba(${R},${G},${B},${a})`;
  const h = sprayHardness();
  if (h >= 1) {
    ctx.fillStyle = col(1);
  } else {
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, col(1));
    g.addColorStop(h, col(1));
    g.addColorStop(h + (1 - h) * (brush.cap === 'fat' ? 0.3 : 0.5), col(brush.cap === 'fat' ? 0.3 : 0.25));
    g.addColorStop(1, col(0));
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();
  stamp = c;
}

function spacing(): number {
  return Math.max(1, sprayDiameter() * 0.12);
}

// Per-dab alpha so overlapping dabs along a stroke converge to the chosen opacity.
function dabAlpha(): number {
  const overlaps = Math.max(1, sprayDiameter() / spacing());
  return 1 - Math.pow(1 - brush.opacity, 1 / overlaps);
}

function dab(x: number, y: number): void {
  const r = stamp.width / 2;
  strokeCtx.drawImage(stamp, x - r, y - r);
}

// ---------- Tools ----------
const TAU = Math.PI * 2;
const ROLLER_THICK = 6;
const PAINTBALL_INTERVAL = 70;
let sprayAlpha = 1;
let rollerBounds = { minX: 0, maxX: 0, maxY: 0 };
let rollerStreaks: CanvasPattern | null = null;

const ROLLER_PRESETS: Record<RollerPreset, number> = { standard: 180, wide: 360 };
const sizeT = () => (brush.size - 2) / 148;
const rollerWidth = () => ROLLER_PRESETS[brush.roller] * (0.75 + sizeT() * 0.5);
const mopNib = () => 4 + sizeT() * 36;
const chiselWidth = () => 6 + sizeT() * 54;

// Stroke-layer tools are composited once on release, which is where sheen and glaze hook in.
const usesStrokeLayer = () => brush.tool !== 'paintball' && brush.tool !== 'buff';
// Spray dabs already carry their own per-dab alpha.
const strokeAlpha = () => (brush.tool === 'spray' ? 1 : brush.opacity);

// Silver/chrome: bright and nearly unsaturated, but not pure white.
function isChrome(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 510;
  const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  return l > 0.75 && l < 0.96 && s < 0.2;
}

function applyChromeSheen(): void {
  const b = strokeBox;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (!(w > 0 && h > 0)) return;
  strokeCtx.save();
  strokeCtx.globalCompositeOperation = 'source-atop';
  const g = strokeCtx.createLinearGradient(0, b.minY, 0, b.maxY);
  g.addColorStop(0, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.38, 'rgba(235,240,248,0.25)');
  g.addColorStop(0.5, 'rgba(70,80,96,0.55)');
  g.addColorStop(0.58, 'rgba(150,160,175,0.3)');
  g.addColorStop(1, 'rgba(255,255,255,0.7)');
  strokeCtx.fillStyle = g;
  strokeCtx.fillRect(b.minX, b.minY, w, h);
  const glint = strokeCtx.createLinearGradient(b.minX, b.minY, b.maxX, b.maxY);
  glint.addColorStop(0.3, 'rgba(255,255,255,0)');
  glint.addColorStop(0.36, 'rgba(255,255,255,0.5)');
  glint.addColorStop(0.42, 'rgba(255,255,255,0)');
  strokeCtx.fillStyle = glint;
  strokeCtx.fillRect(b.minX, b.minY, w, h);
  strokeCtx.restore();
}

// ---------- Wet glaze (render-only, fades to matte) ----------
const GLAZE_MS = 2500;
const MAX_GLAZES = 6;
const glazes: { c: HTMLCanvasElement; x: number; y: number; t0: number }[] = [];

// Top-left rim of the fresh stroke: its mask minus itself shifted down-right.
function spawnGlaze(): void {
  const x0 = Math.max(BODY.x, Math.floor(strokeBox.minX));
  const y0 = Math.max(BODY.y, Math.floor(strokeBox.minY));
  const w = Math.min(BODY.x + BODY.w, Math.ceil(strokeBox.maxX)) - x0;
  const h = Math.min(BODY.y + BODY.h, Math.ceil(strokeBox.maxY)) - y0;
  if (w < 4 || h < 4) return;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(strokeLayer, x0, y0, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(strokeLayer, x0, y0, w, h, 3, 3, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  glazes.push({ c, x: x0, y: y0, t0: performance.now() });
  if (glazes.length > MAX_GLAZES) glazes.shift();
}
// Nib runs lower-left to upper-right: down-strokes go broad, 45° up-right slices go hairline.
const CHISEL_ANGLE = -Math.PI / 4;

function drawChiselNib(x: number, y: number): void {
  const h = chiselWidth() / 2;
  const ax = Math.cos(CHISEL_ANGLE) * h;
  const ay = Math.sin(CHISEL_ANGLE) * h;
  strokeCtx.lineWidth = 1.5;
  strokeCtx.beginPath();
  strokeCtx.moveTo(x - ax, y - ay);
  strokeCtx.lineTo(x + ax, y + ay);
  strokeCtx.stroke();
}

// Sweeps the flat nib from p0 to p1; the swept area gives the direction-dependent width.
function drawChiselSegment(x0: number, y0: number, x1: number, y1: number): void {
  const h = chiselWidth() / 2;
  const ax = Math.cos(CHISEL_ANGLE) * h;
  const ay = Math.sin(CHISEL_ANGLE) * h;
  strokeCtx.beginPath();
  strokeCtx.moveTo(x0 - ax, y0 - ay);
  strokeCtx.lineTo(x0 + ax, y0 + ay);
  strokeCtx.lineTo(x1 + ax, y1 + ay);
  strokeCtx.lineTo(x1 - ax, y1 - ay);
  strokeCtx.closePath();
  strokeCtx.fill();
  drawChiselNib(x1, y1);
}

// ---------- Chalk sketch ----------
const sketchWidth = () => 2 + sizeT() * 6;
let sketchLast = { x: 0, y: 0 };
let sketchCarry = 0;

// Dry chalk: sparse jittered specks instead of a solid line, so it reads as dusty.
function chalkAt(x: number, y: number): void {
  const w = sketchWidth();
  sketchCtx.fillStyle = brush.color;
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * TAU;
    const d = Math.random() * w * 0.5;
    const s = 0.6 + Math.random() * 1.4;
    sketchCtx.globalAlpha = 0.25 + Math.random() * 0.45;
    sketchCtx.fillRect(x + Math.cos(a) * d - s / 2, y + Math.sin(a) * d - s / 2, s, s);
  }
  sketchCtx.globalAlpha = 1;
}

function sketchTo(x: number, y: number): void {
  const dx = x - sketchLast.x;
  const dy = y - sketchLast.y;
  const dist = Math.hypot(dx, dy);
  if (!dist) return;
  const step = 1.2;
  let t = step - sketchCarry;
  while (t <= dist) {
    chalkAt(sketchLast.x + (dx * t) / dist, sketchLast.y + (dy * t) / dist);
    t += step;
  }
  sketchCarry = dist - (t - step);
  sketchLast = { x, y };
}
// ---------- Stencils (editor-only masks) ----------
type StencilKind = 'diamond' | 'stripes' | 'star' | 'target' | 'text' | 'bar';
interface Stencil {
  kind: StencilKind;
  x: number;
  y: number;
  size: number;
  invert: boolean;
  text: string;
  // Half-extents of the Bar cutout, stretched independently.
  bw: number;
  bh: number;
  // Radians, clockwise around (x, y).
  angle: number;
}
// Sheet margin around the Bar cutout.
const BAR_MARGIN = 30;
// Rotate knob distance above the sheet's top edge, in screen px.
const ROT_KNOB_PX = 40;
const ROT_SNAP = Math.PI / 12;
let stencil: Stencil | null = null;
let stencilEdit = false;
let adjust = { kind: 'move' as 'move' | 'resize' | 'rotate', dx: 0, dy: 0 };

function toStencilLocal(s: Stencil, x: number, y: number): [number, number] {
  const c = Math.cos(-s.angle);
  const sn = Math.sin(-s.angle);
  const dx = x - s.x;
  const dy = y - s.y;
  return [dx * c - dy * sn, dx * sn + dy * c];
}

// Heavy military/crate stencil face from Google Fonts; canvas uses the fallbacks until it loads.
const STENCIL_FONT = '"Stardos Stencil", "Allerta Stencil", Impact, sans-serif';
const stencilFontPx = (s: Stencil) => s.size * 0.6;
const measureCtx = document.createElement('canvas').getContext('2d')!;

function sheetHalf(s: Stencil): { hw: number; hh: number } {
  if (s.kind === 'bar') return { hw: s.bw + BAR_MARGIN, hh: s.bh + BAR_MARGIN };
  if (s.kind !== 'text') return { hw: s.size * 0.6, hh: s.size * 0.6 };
  const f = stencilFontPx(s);
  measureCtx.font = `700 ${f}px ${STENCIL_FONT}`;
  return { hw: measureCtx.measureText(s.text).width / 2 + f * 0.3, hh: f * 0.62 };
}

// Cutout geometry in car space; all shapes fit inside the 1.2×size sheet and are filled even-odd.
function addStencilShape(p: Path2D, s: Stencil): void {
  const { x, y, size: k } = s;
  if (s.kind === 'diamond') {
    const q = k * 0.25;
    const d = k * 0.22;
    for (const [ox, oy] of [
      [0, -q],
      [q, 0],
      [0, q],
      [-q, 0],
    ] as const) {
      p.moveTo(x + ox, y + oy - d);
      p.lineTo(x + ox + d, y + oy);
      p.lineTo(x + ox, y + oy + d);
      p.lineTo(x + ox - d, y + oy);
      p.closePath();
    }
  } else if (s.kind === 'stripes') {
    const h = k * 0.25;
    const w = k * 0.12;
    for (let i = 0; i < 3; i++) {
      const b = x - k * 0.5 + i * k * 0.22;
      p.moveTo(b, y + h);
      p.lineTo(b + w, y + h);
      p.lineTo(b + w + 2 * h, y - h);
      p.lineTo(b + 2 * h, y - h);
      p.closePath();
    }
  } else if (s.kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? k * 0.2 : k * 0.5;
      if (i === 0) p.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else p.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    p.closePath();
  } else if (s.kind === 'bar') {
    p.rect(x - s.bw, y - s.bh, s.bw * 2, s.bh * 2);
  } else {
    p.moveTo(x + k * 0.42, y);
    p.arc(x, y, k * 0.42, 0, TAU);
    p.moveTo(x + k * 0.34, y);
    p.arc(x, y, k * 0.34, 0, TAU);
    p.rect(x - k * 0.03, y - k * 0.55, k * 0.06, k * 0.45);
    p.rect(x - k * 0.03, y + k * 0.1, k * 0.06, k * 0.45);
    p.rect(x - k * 0.55, y - k * 0.03, k * 0.45, k * 0.06);
    p.rect(x + k * 0.1, y - k * 0.03, k * 0.45, k * 0.06);
    p.moveTo(x + k * 0.05, y);
    p.arc(x, y, k * 0.05, 0, TAU);
  }
}

// Allowed-paint mask in car space (opaque = paint may land), rebuilt lazily when the stencil
// changes. Raster so real font glyphs can cut the stencil just like vector shapes.
const [maskLayer, maskCtx] = makeLayer();
const MASK_CPU_SCALE = 0.25;
let maskStale = true;
let maskCpu: Uint8ClampedArray | null = null;
let filmCanvas: HTMLCanvasElement | null = null;
let filmBox = { x: 0, y: 0, w: 0, h: 0 };
const maskScratch = document.createElement('canvas');
const maskScratchCtx = maskScratch.getContext('2d')!;

function markStencilChanged(): void {
  maskStale = true;
  maskCpu = null;
  filmCanvas = null;
  dirty = true;
}

// Fills (or outlines) the cutout in the stencil's local frame: origin at center, unrotated.
function paintShapeLocal(ctx: CanvasRenderingContext2D, s: Stencil, outline = false): void {
  if (s.kind === 'text') {
    ctx.font = `700 ${stencilFontPx(s)}px ${STENCIL_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) ctx.strokeText(s.text, 0, 0);
    else ctx.fillText(s.text, 0, 0);
    return;
  }
  const p = new Path2D();
  addStencilShape(p, { ...s, x: 0, y: 0 });
  if (outline) ctx.stroke(p);
  else ctx.fill(p, 'evenodd');
}

function inStencilFrame(ctx: CanvasRenderingContext2D, s: Stencil, draw: () => void): void {
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  draw();
  ctx.restore();
}

// Axis-aligned half-extents of the rotated sheet.
function sheetExtents(s: Stencil): { ex: number; ey: number } {
  const { hw, hh } = sheetHalf(s);
  const c = Math.abs(Math.cos(s.angle));
  const sn = Math.abs(Math.sin(s.angle));
  return { ex: hw * c + hh * sn, ey: hw * sn + hh * c };
}

function ensureMask(): boolean {
  const s = stencil;
  if (!s) return false;
  if (!maskStale) return true;
  maskStale = false;
  const { hw, hh } = sheetHalf(s);
  maskCtx.globalCompositeOperation = 'source-over';
  maskCtx.fillStyle = '#000';
  maskCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  maskCtx.fillRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  maskCtx.globalCompositeOperation = 'destination-out';
  inStencilFrame(maskCtx, s, () => {
    if (s.invert) {
      paintShapeLocal(maskCtx, s);
    } else {
      maskCtx.fillRect(-hw, -hh, hw * 2, hh * 2);
      maskCtx.globalCompositeOperation = 'source-over';
      paintShapeLocal(maskCtx, s);
    }
  });
  maskCtx.globalCompositeOperation = 'source-over';
  return true;
}

// Keeps only what the mask allows of a car-pixel-aligned scratch canvas placed at (px, py).
function applyMaskTo(ctx: CanvasRenderingContext2D, w: number, h: number, px: number, py: number): void {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskLayer, px, py, w, h, 0, 0, w, h);
  ctx.restore();
}

function maskedStamp(img: HTMLCanvasElement, px: number, py: number): HTMLCanvasElement {
  if (!ensureMask()) return img;
  maskScratch.width = img.width;
  maskScratch.height = img.height;
  maskScratchCtx.drawImage(img, 0, 0);
  applyMaskTo(maskScratchCtx, img.width, img.height, px, py);
  return maskScratch;
}

// Point test for drips, from a low-res CPU copy of the mask.
function maskAllows(x: number, y: number): boolean {
  if (!ensureMask()) return true;
  const w = Math.ceil(CAR_WIDTH * MASK_CPU_SCALE);
  if (!maskCpu) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.ceil(CAR_HEIGHT * MASK_CPU_SCALE);
    const k = c.getContext('2d', { willReadFrequently: true })!;
    k.drawImage(maskLayer, 0, 0, c.width, c.height);
    maskCpu = k.getImageData(0, 0, c.width, c.height).data;
  }
  const i = (Math.floor(y * MASK_CPU_SCALE) * w + Math.floor(x * MASK_CPU_SCALE)) * 4 + 3;
  return (maskCpu[i] ?? 0) > 127;
}

// Trims the pending stroke to the stencil within the stroke's bounding box.
function maskStrokeLayer(): void {
  if (!ensureMask()) return;
  const x0 = Math.max(0, Math.floor(strokeBox.minX));
  const y0 = Math.max(0, Math.floor(strokeBox.minY));
  const x1 = Math.min(CAR_WIDTH, Math.ceil(strokeBox.maxX));
  const y1 = Math.min(CAR_HEIGHT, Math.ceil(strokeBox.maxY));
  if (x1 <= x0 || y1 <= y0) return;
  strokeCtx.save();
  strokeCtx.globalCompositeOperation = 'destination-in';
  strokeCtx.drawImage(maskLayer, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  strokeCtx.restore();
}

// Kraft film overlay, cached per stencil state: sheet (or shape, when inverted) minus the cutout.
function ensureFilm(): void {
  const s = stencil;
  if (!s || filmCanvas) return;
  const { hw, hh } = sheetHalf(s);
  const { ex: rx, ey: ry } = sheetExtents(s);
  const ex = rx + 4;
  const ey = ry + 4;
  const res = Math.min(1, 1024 / Math.max(ex, ey));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.ceil(ex * 2 * res));
  cv.height = Math.max(1, Math.ceil(ey * 2 * res));
  const k = cv.getContext('2d')!;
  k.scale(res, res);
  k.translate(ex, ey);
  k.rotate(s.angle);
  const body = () => (s.invert ? paintShapeLocal(k, s) : k.fillRect(-hw, -hh, hw * 2, hh * 2));
  k.fillStyle = 'rgba(196,164,112,0.6)';
  body();
  k.fillStyle = kraftPattern(k);
  body();
  if (!s.invert) {
    k.globalCompositeOperation = 'destination-out';
    k.fillStyle = '#000';
    paintShapeLocal(k, s);
    k.globalCompositeOperation = 'source-over';
  }
  k.strokeStyle = 'rgba(70,45,20,0.85)';
  k.lineWidth = 2.5;
  paintShapeLocal(k, s, true);
  if (!s.invert) k.strokeRect(-hw, -hh, hw * 2, hh * 2);
  filmCanvas = cv;
  filmBox = { x: s.x - ex, y: s.y - ey, w: ex * 2, h: ey * 2 };
}

void document.fonts?.load(`700 100px "Stardos Stencil"`).then(() => {
  if (stencil?.kind === 'text') markStencilChanged();
});

function tryBeginAdjust(sx: number, sy: number): boolean {
  const [x, y] = screenToCar(sx, sy);
  if (stencil && stencilEdit) {
    const { hw, hh } = sheetHalf(stencil);
    const hs = 14 / cam.scale;
    const [lx, ly] = toStencilLocal(stencil, x, y);
    if (Math.hypot(lx, ly + hh + ROT_KNOB_PX / cam.scale) < hs) {
      adjust = { kind: 'rotate', dx: 0, dy: 0 };
      return true;
    }
    if (Math.abs(lx - hw) < hs && Math.abs(ly - hh) < hs) {
      adjust = { kind: 'resize', dx: 0, dy: 0 };
      return true;
    }
    if (Math.abs(lx) < hw && Math.abs(ly) < hh) {
      adjust = { kind: 'move', dx: x - stencil.x, dy: y - stencil.y };
      return true;
    }
  }
  return false;
}

function dragAdjust(x: number, y: number, snap: boolean): void {
  if (stencil && adjust.kind === 'move') {
    stencil.x = x - adjust.dx;
    stencil.y = y - adjust.dy;
  } else if (stencil && adjust.kind === 'rotate') {
    // Knob sits straight above center, so pointing up (-90°) means 0 rotation.
    const a = Math.atan2(y - stencil.y, x - stencil.x) + Math.PI / 2;
    stencil.angle = snap ? Math.round(a / ROT_SNAP) * ROT_SNAP : a;
  } else if (stencil?.kind === 'bar') {
    const [lx, ly] = toStencilLocal(stencil, x, y);
    stencil.bw = Math.max(8, Math.min(2000, Math.abs(lx) - BAR_MARGIN));
    stencil.bh = Math.max(3, Math.min(600, Math.abs(ly) - BAR_MARGIN));
  } else if (stencil) {
    // Scale so the dragged corner follows the cursor, for square and text sheets alike.
    const { hw, hh } = sheetHalf(stencil);
    const [lx, ly] = toStencilLocal(stencil, x, y);
    const f = Math.max(Math.abs(lx) / hw, Math.abs(ly) / hh);
    stencil.size = Math.max(60, Math.min(1400, stencil.size * f));
  }
  markStencilChanged();
}

function drawStencil(ctx: CanvasRenderingContext2D): void {
  const s = stencil!;
  const { hw, hh } = sheetHalf(s);
  ensureFilm();
  // Kraft-card film lifted slightly off the steel by a soft shadow.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 5;
  ctx.drawImage(filmCanvas!, filmBox.x, filmBox.y, filmBox.w, filmBox.h);
  ctx.restore();
  if (!stencilEdit) return;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);
  ctx.strokeStyle = 'rgba(255,255,255,0.7)';
  ctx.setLineDash([8 / cam.scale, 6 / cam.scale]);
  ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.setLineDash([]);
  const hs = 10 / cam.scale;
  ctx.fillStyle = '#fff';
  ctx.fillRect(hw - hs, hh - hs, hs * 2, hs * 2);
  const knobY = -hh - ROT_KNOB_PX / cam.scale;
  ctx.beginPath();
  ctx.moveTo(0, -hh);
  ctx.lineTo(0, knobY);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, knobY, 9 / cam.scale, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1.5 / cam.scale;
  ctx.stroke();
  ctx.restore();
}

let kraft: CanvasPattern | null = null;

function kraftPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (kraft) return kraft;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const k = c.getContext('2d')!;
  const r = seededRandom(21);
  for (let i = 0; i < 900; i++) {
    k.fillStyle = `rgba(90,60,30,${r() * 0.18})`;
    k.fillRect(r() * 96, r() * 96, 1 + r() * 6, 1);
  }
  kraft = ctx.createPattern(c, 'repeat')!;
  return kraft;
}

// Stencil action pill: centered below the sheet, flipping above (or clamping) near the bottom.
function positionStencilHud(): void {
  if (!stencil) return;
  const { ey } = sheetExtents(stencil);
  const w = stencilHud.offsetWidth;
  const h = stencilHud.offsetHeight;
  const gap = 18;
  const sx = cam.x + stencil.x * cam.scale;
  let bottomEdge = cam.y + (stencil.y + ey) * cam.scale;
  let topEdge = cam.y + (stencil.y - ey) * cam.scale;
  if (stencilEdit) {
    // The rotate knob can end up below the sheet when rotated; keep the pill clear of it either way.
    const { hh } = sheetHalf(stencil);
    const d = hh + ROT_KNOB_PX / cam.scale;
    const ky = cam.y + (stencil.y - Math.cos(stencil.angle) * d) * cam.scale;
    bottomEdge = Math.max(bottomEdge, ky + 14);
    topEdge = Math.min(topEdge, ky - 14);
  }
  // Stay above the dock when it's showing.
  const dockTop = document.body.classList.contains('rollby') ? window.innerHeight : toolbarEl.getBoundingClientRect().top;
  const floor = Math.min(window.innerHeight, dockTop) - 8;
  let y = bottomEdge + gap;
  if (y + h > floor) {
    const above = topEdge - gap - h;
    y = above >= 8 ? above : floor - h;
  }
  stencilHud.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, sx - w / 2))}px`;
  stencilHud.style.top = `${Math.max(8, y)}px`;
}

// ---------- Yard Buff eraser ----------
let buffStamp = document.createElement('canvas');

function buildBuffStamp(): void {
  const d = Math.max(2, Math.ceil(brush.size));
  const r = d / 2;
  const c = document.createElement('canvas');
  c.width = c.height = d;
  const ctx = c.getContext('2d')!;
  if (brush.hardness >= 1) {
    ctx.fillStyle = '#000';
  } else {
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(brush.hardness, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
  }
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  buffStamp = c;
}

// ---------- Mop (squeeze marker) ----------
const MOP_HOLD_INTERVAL = 40;
let mopStamp = document.createElement('canvas');
let mopFlow = 0.6;
let lastMopMove = { x: 0, y: 0, t: 0 };
let lastMopDrip = { x: -1e9, y: -1e9 };

// Solid felt core with a soft wet bleed at the rim; drawn at the max squeezed size.
function buildMopStamp(): void {
  const d = Math.ceil(mopNib() * 1.4) + 4;
  const r = d / 2;
  const c = document.createElement('canvas');
  c.width = c.height = d;
  const ctx = c.getContext('2d')!;
  const [R, G, B] = hexToRgb(brush.color);
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, `rgba(${R},${G},${B},1)`);
  g.addColorStop(0.78, `rgba(${R},${G},${B},1)`);
  g.addColorStop(0.9, `rgba(${R},${G},${B},0.55)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  mopStamp = c;
}

// Slow drags (or pen pressure) push more ink.
function updateMopFlow(x: number, y: number, ev: PointerEvent): void {
  const dt = Math.max(1, ev.timeStamp - lastMopMove.t);
  const speed = Math.hypot(x - lastMopMove.x, y - lastMopMove.y) / dt;
  let target = 1 - speed / 2;
  if (ev.pointerType === 'pen' && ev.pressure > 0) target += (ev.pressure - 0.5) * 0.8;
  target = Math.min(1, Math.max(0.1, target));
  mopFlow += (target - mopFlow) * 0.3;
  lastMopMove = { x, y, t: ev.timeStamp };
}
const paintballRadius = () => 8 + sizeT() * 17;

function toolSpacing(): number {
  if (brush.tool === 'roller') return ROLLER_THICK / 2;
  if (brush.tool === 'mop') return Math.max(1, mopNib() * 0.2);
  if (brush.tool === 'buff') return Math.max(1, brush.size * 0.1);
  if (brush.tool === 'paintball') return paintballRadius() * 2.5;
  return spacing();
}

// Splats are built at full alpha on a scratch canvas, then laid down once at the chosen opacity.
const splat = document.createElement('canvas');
const splatCtx = splat.getContext('2d')!;

function impact(x: number, y: number): void {
  const R = paintballRadius();
  const r = R * (0.85 + Math.random() * 0.3);
  const half = Math.ceil(r * 3.3 + 4);
  splat.width = half * 2;
  splat.height = half * 2 + Math.ceil(r + 44);
  const c = splatCtx;
  c.fillStyle = brush.color;
  const cx = half;
  const cy = half;

  // Burst: lobed, spiky blob whose lower half sags slightly.
  c.beginPath();
  const lobes = 20;
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU;
    const rr = r * (Math.random() < 0.2 ? 1.2 + Math.random() * 0.25 : 0.88 + Math.random() * 0.18);
    const px = cx + Math.cos(a) * rr;
    const py = cy + Math.sin(a) * rr * (Math.sin(a) > 0 ? 1.15 : 1);
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();
  c.fill();

  // Tapered micro-splatters trailing outward, each ending in a droplet.
  const streaks = 4 + Math.floor(Math.random() * 5);
  for (let i = 0; i < streaks; i++) {
    const a = Math.random() * TAU;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const d0 = r * 0.9;
    const d1 = r * (1.7 + Math.random() * 1.3);
    const w = r * (0.1 + Math.random() * 0.1);
    c.beginPath();
    c.moveTo(cx + ux * d0 - uy * w, cy + uy * d0 + ux * w);
    c.lineTo(cx + ux * d0 + uy * w, cy + uy * d0 - ux * w);
    c.lineTo(cx + ux * d1, cy + uy * d1);
    c.closePath();
    c.fill();
    c.beginPath();
    c.arc(cx + ux * d1, cy + uy * d1, r * (0.07 + Math.random() * 0.12), 0, TAU);
    c.fill();
  }

  if (Math.random() < 0.2) {
    const len = 10 + Math.random() * 30;
    const w = r * (0.25 + Math.random() * 0.2);
    c.fillRect(cx - w / 2, cy, w, r + len);
    c.beginPath();
    c.arc(cx, cy + r + len, w * 0.6, 0, TAU);
    c.fill();
  }

  paintCtx.globalAlpha = brush.opacity;
  const px = Math.round(x + (Math.random() - 0.5) * R * 0.8 - half);
  const py = Math.round(y + (Math.random() - 0.5) * R * 0.8 - half);
  if (ensureMask()) applyMaskTo(c, splat.width, splat.height, px, py);
  paintCtx.drawImage(splat, px, py);
}

// How far a tool's mark can reach from its centre point.
function toolReach(): number {
  switch (brush.tool) {
    case 'spray':
      return sprayDiameter() * 0.7;
    case 'roller':
      return rollerWidth() / 2;
    case 'mop':
      return mopNib() * 0.7;
    case 'chisel':
      return chiselWidth() / 2;
    case 'paintball':
      return paintballRadius() * 3.5;
    default:
      return brush.size / 2;
  }
}

// History is recorded lazily on the first mark that can reach the body, so clicks on the
// sky/ballast never create empty undo steps.
function markTouch(x0: number, y0: number, x1: number, y1: number): boolean {
  const r = toolReach();
  const hit =
    Math.max(x0, x1) + r >= BODY.x &&
    Math.min(x0, x1) - r <= BODY.x + BODY.w &&
    Math.max(y0, y1) + r >= BODY.y &&
    Math.min(y0, y1) - r <= BODY.y + BODY.h;
  if (hit && !strokeTouched) {
    strokeTouched = true;
    pushHistory();
  }
  if (hit) {
    strokeBox.minX = Math.min(strokeBox.minX, Math.min(x0, x1) - r);
    strokeBox.minY = Math.min(strokeBox.minY, Math.min(y0, y1) - r);
    strokeBox.maxX = Math.max(strokeBox.maxX, Math.max(x0, x1) + r);
    strokeBox.maxY = Math.max(strokeBox.maxY, Math.max(y0, y1) + r);
  }
  return hit;
}

function stampAt(x: number, y: number): void {
  if (!markTouch(x, y, x, y)) return;
  if (brush.tool === 'spray') {
    const flow = sprayFlow();
    if (flow <= 0) return;
    strokeCtx.globalAlpha = sprayAlpha * flow;
    dab(x, y);
    if (brush.cap === 'fat') {
      // Dusty overspray speckle around the fat-cap halo.
      const R = stamp.width / 2;
      strokeCtx.globalAlpha = Math.min(1, sprayAlpha * 2 * flow);
      strokeCtx.fillStyle = brush.color;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU;
        const dist = R * (0.7 + Math.random() * 0.6);
        const s = 0.8 + Math.random() * 1.6;
        strokeCtx.fillRect(x + Math.cos(a) * dist, y + Math.sin(a) * dist, s, s);
      }
    }
    lastDabAt = performance.now();
    addWetness(x, y);
  } else if (brush.tool === 'roller') {
    // Extension-pole roller: barrel is always horizontal, so vertical drags fill broad columns.
    const w = rollerWidth();
    const left = x - w / 2;
    const top = y - ROLLER_THICK / 2;
    strokeCtx.fillRect(left, top, w, ROLLER_THICK);
    if (rollerStreaks) {
      rollerStreaks.setTransform(new DOMMatrix().translate(left, 0));
      strokeCtx.globalCompositeOperation = 'destination-out';
      strokeCtx.fillStyle = rollerStreaks;
      strokeCtx.fillRect(left, top, w, ROLLER_THICK);
      strokeCtx.globalCompositeOperation = 'source-over';
      strokeCtx.fillStyle = brush.color;
    }
    rollerBounds.minX = Math.min(rollerBounds.minX, x);
    rollerBounds.maxX = Math.max(rollerBounds.maxX, x);
    rollerBounds.maxY = Math.max(rollerBounds.maxY, y);
  } else if (brush.tool === 'chisel') {
    drawChiselNib(x, y);
  } else if (brush.tool === 'buff') {
    // Only the paint layer is erased; the car base and markings live on separate layers.
    const r = buffStamp.width / 2;
    paintCtx.globalCompositeOperation = 'destination-out';
    paintCtx.globalAlpha = 1;
    const bx = Math.round(x - r);
    const by = Math.round(y - r);
    paintCtx.drawImage(maskedStamp(buffStamp, bx, by), bx, by);
    paintCtx.globalCompositeOperation = 'source-over';
  } else if (brush.tool === 'mop') {
    const d = mopNib() * (0.9 + mopFlow * 0.45) * (0.96 + Math.random() * 0.08);
    strokeCtx.drawImage(mopStamp, x - d / 2, y - d / 2, d, d);
    lastDabAt = performance.now();
    // Heavy squeeze sheds drips from the letters, spaced so one spot doesn't curtain.
    if (
      Math.random() < 0.004 + 0.08 * mopFlow ** 3 &&
      Math.hypot(x - lastMopDrip.x, y - lastMopDrip.y) > mopNib() * 1.5
    ) {
      lastMopDrip = { x, y };
      spawnDrip(
        x + (Math.random() - 0.5) * d * 0.4,
        y + d * 0.3,
        mopNib() * (0.3 + Math.random() * 0.3),
        (40 + Math.random() * 180) * (0.4 + mopFlow),
        brush.color,
        Math.min(1, brush.opacity * 1.1),
      );
    }
  } else {
    impact(x, y);
  }
}

function strokeTo(x: number, y: number): void {
  const dx = x - lastCar.x;
  const dy = y - lastCar.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  if (brush.tool === 'chisel') {
    if (markTouch(lastCar.x, lastCar.y, x, y)) drawChiselSegment(lastCar.x, lastCar.y, x, y);
    lastCar = { x, y };
    return;
  }
  const step = toolSpacing();
  let t = step - carry;
  while (t <= dist) {
    stampAt(lastCar.x + (dx * t) / dist, lastCar.y + (dy * t) / dist);
    t += step;
  }
  carry = dist - (t - step);
  lastCar = { x, y };
}

function commitRoller(): void {
  strokeCtx.globalAlpha = 1;
  maskStrokeLayer();
  if (strokeTouched) {
    if (isChrome(brush.color)) applyChromeSheen();
    spawnGlaze();
  }
  if (brush.tool === 'chisel') {
    // Subtle ink bleed: faint blurred halo beneath the sharp stroke.
    paintCtx.filter = 'blur(1.5px)';
    paintCtx.globalAlpha = brush.opacity * 0.35;
    paintCtx.drawImage(strokeLayer, 0, 0);
    paintCtx.filter = 'none';
  }
  paintCtx.globalAlpha = strokeAlpha();
  paintCtx.drawImage(strokeLayer, 0, 0);
  paintCtx.globalAlpha = 1;
  strokeCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);

  // Saturated passes occasionally weep small runs off the bottom edge.
  if (strokeTouched && brush.tool === 'roller' && Math.random() < (brush.opacity - 0.6) * 1.5) {
    const w = rollerWidth();
    const span = rollerBounds.maxX - rollerBounds.minX + w;
    const runs = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < runs; i++) {
      spawnDrip(
        rollerBounds.minX - w / 2 + Math.random() * span,
        rollerBounds.maxY + ROLLER_THICK / 2 - 1,
        2 + Math.random() * 2.5,
        15 + Math.random() * 45,
        brush.color,
        brush.opacity,
      );
    }
  }
}

// Per-stroke nap texture: partial-erase columns that drag into vertical streaks; edges stay solid.
function buildRollerStreaks(): void {
  const w = Math.ceil(rollerWidth());
  const c = document.createElement('canvas');
  c.width = w;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, 1);
  let v = 0.12;
  for (let x = 0; x < w; x++) {
    v = Math.min(0.32, Math.max(0, v + (Math.random() - 0.5) * 0.06));
    const streak = Math.random() < 0.03 ? 0.25 : 0;
    const edge = Math.min(x, w - 1 - x) < 3;
    img.data[x * 4 + 3] = edge ? 0 : Math.round(Math.min(0.5, v + streak) * 255);
  }
  ctx.putImageData(img, 0, 0);
  rollerStreaks = strokeCtx.createPattern(c, 'repeat-y');
}

// ---------- Drips ----------
const WET_CELL = 20;
const WET_COLS = Math.ceil(CAR_WIDTH / WET_CELL);
const WET_ROWS = Math.ceil(CAR_HEIGHT / WET_CELL);
const wetness = new Float32Array(WET_COLS * WET_ROWS);
const DRIP_THRESHOLD = 3;
const MAX_DRIPS = 40;
// Holding the can still keeps spraying at this interval, building up paint.
const SPRAY_HOLD_INTERVAL = 30;
let lastDabAt = 0;
let lastDripTick = 0;

interface Drip {
  x: number;
  y: number;
  startY: number;
  endY: number;
  w0: number;
  v0: number;
  color: string;
  alpha: number;
}
const drips: Drip[] = [];

function spawnDrip(x: number, y: number, w0: number, len: number, color: string, alpha: number): void {
  if (drips.length >= MAX_DRIPS) return;
  const endY = Math.min(y + len, BODY.y + BODY.h - 2);
  if (endY <= y + 4) return;
  drips.push({ x, y, startY: y, endY, w0, v0: 50 + Math.random() * 60, color, alpha });
  dirty = true;
}

function addWetness(x: number, y: number): void {
  const inc = Math.min(sprayAlpha, 0.35) * brush.opacity * (brush.cap === 'fat' ? 1.4 : 0.7);
  const r = Math.max(WET_CELL / 2, sprayDiameter() * 0.25);
  const c0 = Math.max(0, Math.floor((x - r) / WET_CELL));
  const c1 = Math.min(WET_COLS - 1, Math.floor((x + r) / WET_CELL));
  const r0 = Math.max(0, Math.floor((y - r) / WET_CELL));
  const r1 = Math.min(WET_ROWS - 1, Math.floor((y + r) / WET_CELL));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const i = row * WET_COLS + col;
      const v = wetness[i]! + inc;
      if (v < DRIP_THRESHOLD) {
        wetness[i] = v;
        continue;
      }
      // Dry out the neighbourhood so a wet patch sheds a few spaced drips, not a curtain.
      for (let rr = Math.max(0, row - 1); rr <= Math.min(WET_ROWS - 1, row + 1); rr++) {
        for (let cc = Math.max(0, col - 2); cc <= Math.min(WET_COLS - 1, col + 2); cc++) wetness[rr * WET_COLS + cc] = 0;
      }
      spawnDrip(
        (col + Math.random()) * WET_CELL,
        (row + 0.8) * WET_CELL,
        Math.min(7, Math.max(1.5, brush.size * 0.06)) * (0.7 + Math.random() * 0.6),
        30 + Math.random() * (60 + brush.size * 1.5),
        brush.color,
        Math.min(1, brush.opacity * 1.15),
      );
    }
  }
}

function drawDripSegment(d: Drip, ny: number): void {
  const w = d.w0 * (1 - 0.45 * ((ny - d.startY) / (d.endY - d.startY)));
  paintCtx.globalAlpha = d.alpha;
  paintCtx.fillStyle = d.color;
  if (maskAllows(d.x, d.y)) paintCtx.fillRect(d.x - w / 2, d.y, w, ny - d.y);
  d.y = ny;
}

function drawDripTip(d: Drip): void {
  paintCtx.globalAlpha = d.alpha;
  paintCtx.fillStyle = d.color;
  paintCtx.beginPath();
  paintCtx.arc(d.x, d.y - d.w0 * 0.1, d.w0 * 0.5, 0, TAU);
  if (maskAllows(d.x, d.y)) paintCtx.fill();
}

function updateDrips(now: number): void {
  const dt = Math.min(0.05, (now - lastDripTick) / 1000);
  lastDripTick = now;
  if (!drips.length) return;
  for (let i = drips.length - 1; i >= 0; i--) {
    const d = drips[i]!;
    const progress = (d.y - d.startY) / (d.endY - d.startY);
    drawDripSegment(d, Math.min(d.endY, d.y + d.v0 * (1 - 0.75 * progress) * dt));
    if (d.y >= d.endY) {
      drawDripTip(d);
      drips.splice(i, 1);
      if (!drips.length) scheduleSave();
    }
  }
  dirty = true;
}

// Completes in-flight drips instantly so snapshots/saves include them.
function finishDrips(): void {
  if (!drips.length) return;
  for (const d of drips) {
    while (d.y < d.endY) drawDripSegment(d, Math.min(d.endY, d.y + 4));
    drawDripTip(d);
  }
  drips.length = 0;
  dirty = true;
}

// ---------- Camera ----------
const cam = { x: 0, y: 0, scale: 1 };
let dpr = 1;
// Phones often report 3x; the reels animate constantly, so 2x is the ceiling that keeps them smooth.
const reelDpr = () => Math.min(dpr, 2);
let dirty = true;

// Phones/tablets in landscape with little height get a collapsible dock and a reserved strip for its toggle.
const compactQuery = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
const DOCK_RESERVE = 56;
const viewHeight = () => window.innerHeight - (compactQuery.matches ? DOCK_RESERVE : 0);

const fitScale = () => Math.min(window.innerWidth / CAR_WIDTH, viewHeight() / CAR_HEIGHT) * 0.95;

// Zoom range is relative to the fitted view: never smaller than 60% of fit, never deeper than ~8x.
function scaleBounds(): [number, number] {
  const fit = fitScale();
  return [Math.max(MIN_SCALE, fit * 0.6), Math.min(MAX_SCALE, Math.max(2, fit * 8))];
}

// Keeps at least a margin of the car on screen so it can't be panned out of sight.
function clampCamera(): void {
  const m = 120;
  cam.x = Math.min(window.innerWidth - m, Math.max(m - CAR_WIDTH * cam.scale, cam.x));
  cam.y = Math.min(window.innerHeight - m, Math.max(m - CAR_HEIGHT * cam.scale, cam.y));
}

function fitTarget(): { x: number; y: number; scale: number } {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, fitScale()));
  return { x: (window.innerWidth - CAR_WIDTH * scale) / 2, y: (viewHeight() - CAR_HEIGHT * scale) / 2, scale };
}

const CAM_ANIM_MS = 350;
let camAnim: { from: typeof cam; to: typeof cam; t0: number } | null = null;

// `animate` eases there and re-enables auto-fit on window resize.
function fitCamera(animate = false): void {
  if (!animate) {
    Object.assign(cam, fitTarget());
    return;
  }
  camMoved = false;
  camAnim = { from: { ...cam }, to: fitTarget(), t0: performance.now() };
  dirty = true;
}

let camMoved = false;

function resize(): void {
  dpr = window.devicePixelRatio || 1;
  viewport.width = Math.floor(window.innerWidth * dpr);
  viewport.height = Math.floor(window.innerHeight * dpr);
  if (!camMoved) fitCamera();
  dirty = true;
}

function screenToCar(sx: number, sy: number): [number, number] {
  const rect = viewport.getBoundingClientRect();
  const scaleX = viewport.width / rect.width;
  const scaleY = viewport.height / rect.height;
  const canvasX = (sx - rect.left) * scaleX;
  const canvasY = (sy - rect.top) * scaleY;
  return [(canvasX / scaleX - cam.x) / cam.scale, (canvasY / scaleY - cam.y) / cam.scale];
}

// ---------- Input ----------
let spaceDown = false;
let mode: 'none' | 'pan' | 'paint' | 'sketch' | 'adjust' | 'pinch' = 'none';
let activePointer = -1;
let lastScreen = { x: 0, y: 0 };
let lastCar = { x: 0, y: 0 };
let carry = 0;
let hover: { x: number; y: number } | null = null;
let lineOrigin: { x: number; y: number } | null = null;
let straightLineTool = false;
let straightLineGesture = false;
let lastShot = 0;

// ---------- Two-finger touch navigation ----------
const touches = new Map<number, { x: number; y: number }>();
// Car-space point under the finger midpoint at gesture start stays pinned under the fingers.
let pinch: { dist: number; scale: number; anchor: [number, number] } | null = null;

// Throws away an in-progress stroke as if it never happened (no paint, no undo step).
function cancelStroke(): void {
  stopHiss();
  strokeCtx.globalAlpha = 1;
  strokeCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  lineOrigin = null;
  straightLineGesture = false;
  drips.length = 0;
  if (mode === 'paint' && strokeTouched) {
    const s = car().undo.pop();
    if (s?.canvas) {
      paintCtx.globalAlpha = 1;
      paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
      paintCtx.drawImage(s.canvas, BODY.x, BODY.y);
    } else if (s) {
      void runBusy(() => drawSnapshot(s));
    }
    strokeTouched = false;
    updateHistoryButtons();
  }
}

function beginPinch(): void {
  if (mode === 'paint' || mode === 'sketch') cancelStroke();
  const [a, b] = [...touches.values()] as [{ x: number; y: number }, { x: number; y: number }];
  pinch = {
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    scale: cam.scale,
    anchor: screenToCar((a.x + b.x) / 2, (a.y + b.y) / 2),
  };
  mode = 'pinch';
  activePointer = -1;
  camAnim = null;
  hover = null;
  dirty = true;
}

function updatePinch(): void {
  const [a, b] = [...touches.values()];
  if (!a || !b || !pinch) return;
  const [minS, maxS] = scaleBounds();
  const scale = Math.min(maxS, Math.max(minS, (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist));
  cam.scale = scale;
  cam.x = (a.x + b.x) / 2 - pinch.anchor[0] * scale;
  cam.y = (a.y + b.y) / 2 - pinch.anchor[1] * scale;
  clampCamera();
  camMoved = true;
  dirty = true;
}
let strokeTouched = false;
let lastSqueakAt = 0;

// Mop squeaks while dragging.
function strokeSounds(): void {
  const now = performance.now();
  if (brush.tool === 'mop' && mopFlow < 0.9 && now - lastSqueakAt > 160 && Math.random() < 0.35) {
    lastSqueakAt = now;
    playSqueak();
  }
}
let strokeBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

function updateCursor(): void {
  viewport.style.cursor = mode === 'pan' || mode === 'adjust' ? 'grabbing' : spaceDown ? 'grab' : 'crosshair';
}

function beginLine(): void {
  if (mode !== 'paint' || lineOrigin) return;
  lineOrigin = { ...lastCar };
  dirty = true;
}

function commitLine(x: number, y: number): void {
  if (!lineOrigin) return;
  lastCar = { ...lineOrigin };
  if (brush.tool === 'paintball') carry = 0;
  strokeTo(x, y);
  lineOrigin = null;
  dirty = true;
}

viewport.addEventListener('pointerdown', (e) => {
  if (roll) {
    if (e.button === 0) {
      const i = rollCarAt(e.clientX, e.clientY);
      // The reel shows the car's card; the editor's Roll-By jumps into painting that car.
      if (roll.showcase) showCard(i);
      else if (i >= 0) exitRollBy(i);
    }
    return;
  }
  // Compact landscape: any touch on the canvas gets the dock out of the way immediately.
  if (compactQuery.matches) document.body.classList.add('dock-tucked');
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size >= 2) {
      if (mode !== 'pinch') beginPinch();
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
  }
  if (mode !== 'none') return;
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    mode = 'pan';
  } else if (e.button === 0 && tryBeginAdjust(e.clientX, e.clientY)) {
    mode = 'adjust';
  } else if (e.button === 0 && stencil && stencilEdit) {
    // Painting is paused while the stencil is being positioned.
    return;
  } else if (e.button === 0 && sketchMode) {
    if (locked()) return;
    mode = 'sketch';
    const [x, y] = screenToCar(e.clientX, e.clientY);
    sketchLast = { x, y };
    sketchCarry = 0;
    chalkAt(x, y);
    sketchHas = true;
    dirty = true;
  } else if (e.button === 0) {
    if (locked()) return;
    mode = 'paint';
    yardStrokeStart();
    strokeTouched = false;
    strokeBox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const [x, y] = screenToCar(e.clientX, e.clientY);
    lastCar = { x, y };
    wetness.fill(0);
    if (brush.tool === 'roller') {
      buildRollerStreaks();
      rollerBounds = { minX: x, maxX: x, maxY: y };
    }
    if (brush.tool === 'mop') {
      buildMopStamp();
      mopFlow = 0.6;
      lastMopMove = { x, y, t: e.timeStamp };
      lastMopDrip = { x: -1e9, y: -1e9 };
    }
    if (brush.tool === 'buff') buildBuffStamp();
    carry = 0;
    sprayAlpha = dabAlpha();
    strokeCtx.fillStyle = brush.color;
    strokeCtx.strokeStyle = brush.color;
    if (brush.tool === 'paintball') lastShot = performance.now();
    straightLineGesture = straightLineTool;
    if (!straightLineGesture) {
      stampAt(x, y);
      if (brush.tool === 'spray') startHiss(brush.opacity);
    } else {
      lineOrigin = { x, y };
      hover = { x: e.clientX, y: e.clientY };
    }
    if (e.shiftKey) lineOrigin = { x, y };
    dirty = true;
  } else {
    return;
  }
  e.preventDefault();
  activePointer = e.pointerId;
  viewport.setPointerCapture(e.pointerId);
  lastScreen = { x: e.clientX, y: e.clientY };
  updateCursor();
});

viewport.addEventListener('pointermove', (e) => {
  hover = { x: e.clientX, y: e.clientY };
  dirty = true;
  if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch') {
      hover = null;
      updatePinch();
      return;
    }
  }
  if (e.pointerId !== activePointer) return;

  if (mode === 'pan') {
    cam.x += e.clientX - lastScreen.x;
    cam.y += e.clientY - lastScreen.y;
    clampCamera();
    camMoved = true;
    camAnim = null;
  } else if (mode === 'adjust') {
    const [ax, ay] = screenToCar(e.clientX, e.clientY);
    dragAdjust(ax, ay, e.shiftKey);
  } else if (mode === 'sketch') {
    for (const ev of e.getCoalescedEvents?.() ?? [e]) sketchTo(...screenToCar(ev.clientX, ev.clientY));
  } else if (mode === 'paint') {
    if (!straightLineGesture && e.shiftKey) beginLine();
    else if (!straightLineGesture && lineOrigin) commitLine(...screenToCar(e.clientX, e.clientY));
    if (!lineOrigin && brush.tool !== 'paintball') {
      for (const ev of e.getCoalescedEvents?.() ?? [e]) {
        const [x, y] = screenToCar(ev.clientX, ev.clientY);
        if (brush.tool === 'mop') updateMopFlow(x, y, ev);
        strokeTo(x, y);
      }
      strokeSounds();
    }
  }
  lastScreen = { x: e.clientX, y: e.clientY };
});

function endPointer(e: PointerEvent): void {
  touches.delete(e.pointerId);
  if (mode === 'pinch') {
    // The finger left behind is ignored until lifted; the next fresh touch paints normally.
    if (touches.size < 2) {
      mode = 'none';
      pinch = null;
      updateCursor();
    }
    return;
  }
  if (e.pointerId !== activePointer) return;
  if (mode === 'paint') {
    if (straightLineGesture) {
      stopHiss();
      commitLine(...screenToCar(e.clientX, e.clientY));
      straightLineGesture = false;
      playPuff();
    } else {
      if (stopHiss()) playPuff();
      commitLine(...screenToCar(e.clientX, e.clientY));
    }
    if (usesStrokeLayer()) commitRoller();
    dirty = true;
    if (strokeTouched) {
      car().hasPaint = brush.tool === 'buff' ? hasVisiblePaint(paintLayer) : true;
      updateConsistUI();
      scheduleSave();
    }
  }
  mode = 'none';
  activePointer = -1;
  straightLineGesture = false;
  paintCtx.globalAlpha = 1;
  updateCursor();
}
viewport.addEventListener('pointerup', endPointer);
viewport.addEventListener('pointercancel', endPointer);
viewport.addEventListener('pointerleave', () => {
  hover = null;
  dirty = true;
});

// Block middle-click autoscroll and context menu.
viewport.addEventListener('mousedown', (e) => {
  if (e.button === 1) e.preventDefault();
});
viewport.addEventListener('contextmenu', (e) => e.preventDefault());

viewport.addEventListener('dblclick', (e) => {
  if (roll) return;
  const [x, y] = screenToCar(e.clientX, e.clientY);
  // Only the background; double-clicks on the body are paint strokes.
  if (x >= BODY.x && x <= BODY.x + BODY.w && y >= BODY.y && y <= BODY.y + BODY.h) return;
  fitCamera(true);
});

viewport.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (roll) return;
    // Normalise line/page deltas to pixels and cap each event so one notch is a ~6% step.
    const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    const factor = Math.exp(-Math.max(-60, Math.min(60, px)) * 0.001);
    const [minS, maxS] = scaleBounds();
    const next = Math.min(maxS, Math.max(minS, cam.scale * factor));
    const k = next / cam.scale;
    cam.x = e.clientX - (e.clientX - cam.x) * k;
    cam.y = e.clientY - (e.clientY - cam.y) * k;
    cam.scale = next;
    clampCamera();
    camMoved = true;
    camAnim = null;
    dirty = true;
  },
  { passive: false },
);

// Block browser pinch/ctrl+wheel page zoom everywhere.
window.addEventListener(
  'wheel',
  (e) => {
    if (e.ctrlKey) e.preventDefault();
  },
  { passive: false },
);

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLInputElement && ['text', 'email', 'password', 'search', 'number'].includes(t.type))
  );
}

window.addEventListener('keydown', (e) => {
  if (authDialog.open || helpDialog.open) return;
  if (!benchEl.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBench();
    }
    return;
  }
  if (roll) {
    if (e.code === 'Space') {
      e.preventDefault();
      toggleRollPause();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (roll.showcase) location.hash = '#yard';
      else exitRollBy();
    }
    return;
  }
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target);
  if (plain && e.key === '?') {
    e.preventDefault();
    toggleHelp();
    return;
  }
  if (plain && (e.key === '<' || e.key === '>' || e.key === ',' || e.key === '.')) {
    e.preventDefault();
    switchCar(currentCarIndex + (e.key === '>' || e.key === '.' ? 1 : -1));
    return;
  }
  if (plain && (e.key === '[' || e.key === ']')) {
    e.preventDefault();
    nudgeSize(e.key === ']' ? 1 : -1);
    return;
  }
  if (plain && !e.repeat && e.key >= '1' && e.key <= '6' && e.key.length === 1) {
    selectTool(TOOL_KEYS[Number(e.key) - 1]!);
    return;
  }
  if (plain && !e.repeat && e.key === '0') {
    fitCamera(true);
    return;
  }
  if (plain && !e.repeat && e.key.toLowerCase() === 'x') {
    swapColors();
    return;
  }
  if (plain && !e.repeat && e.key.toLowerCase() === 's') {
    toggleSketch();
    return;
  }
  if (plain && !e.repeat && e.key.toLowerCase() === 'f') {
    toggleFlashlight();
    return;
  }
  if (plain && e.key === 'Escape' && stencil) {
    e.preventDefault();
    peelStencil();
    return;
  }
  if (plain && !e.repeat && stencil && (e.key.toLowerCase() === 'b' || e.key === 'Enter')) {
    e.preventDefault();
    bakeStencil();
    return;
  }
  if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !isTyping(e.target)) {
    playShake();
    return;
  }
  if (
    e.key.toLowerCase() === 'c' &&
    brush.tool === 'spray' &&
    !e.ctrlKey &&
    !e.metaKey &&
    !e.altKey &&
    !e.repeat &&
    !isTyping(e.target)
  ) {
    setCap(brush.cap === 'fat' ? 'skinny' : 'fat');
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTyping(e.target)) {
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      e.preventDefault();
      if (k === 'y' || e.shiftKey) redo();
      else undo();
      return;
    }
  }
  if (e.key === 'Shift') beginLine();
  if (e.code !== 'Space') return;
  if (isTyping(e.target)) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) (e.target as HTMLElement).blur();
  e.preventDefault();
  if (!spaceDown) {
    spaceDown = true;
    updateCursor();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift' && mode === 'paint') commitLine(...screenToCar(lastScreen.x, lastScreen.y));
  if (e.code !== 'Space') return;
  spaceDown = false;
  updateCursor();
});
window.addEventListener('blur', () => {
  spaceDown = false;
  updateCursor();
});

// ---------- Dock ----------
function bindRange(id: string, apply: (v: number) => void): void {
  const input = document.getElementById(id) as HTMLInputElement;
  const out = document.querySelector(`output[for="${id}"]`);
  const update = () => {
    const v = Number(input.value);
    apply(v);
    if (out) out.textContent = input.dataset.unit === '%' ? `${v}%` : `${v}px`;
    rebuildStamp();
    dirty = true;
  };
  input.addEventListener('input', update);
  update();
}

bindRange('brush-size', (v) => (brush.size = v));
bindRange('brush-hardness', (v) => (brush.hardness = v / 100));
bindRange('brush-opacity', (v) => (brush.opacity = v / 100));

const colorInput = document.getElementById('brush-color') as HTMLInputElement;
colorInput.addEventListener('input', () => {
  brush.color = colorInput.value;
  rebuildStamp();
});
brush.color = colorInput.value;
rebuildStamp();

// Last two committed colors for the X swap; 'change' fires once the picker closes.
let committedColor = colorInput.value;
let prevColor = '#111111';
colorInput.addEventListener('change', () => {
  if (colorInput.value === committedColor) return;
  prevColor = committedColor;
  committedColor = colorInput.value;
});

function swapColors(): void {
  if (mode !== 'none') return;
  [prevColor, committedColor] = [committedColor, prevColor];
  colorInput.value = committedColor;
  brush.color = committedColor;
  rebuildStamp();
  dirty = true;
}

// Swatch picks push the outgoing color into the X-swap slot.
function pickColor(hex: string): void {
  if (mode !== 'none' || hex === committedColor) return;
  prevColor = committedColor;
  committedColor = hex;
  colorInput.value = hex;
  brush.color = hex;
  rebuildStamp();
  dirty = true;
}

const SWATCHES: [string, string][] = [
  ['Burner Chrome', '#e8ecef'],
  ['Pitch Black', '#0a0a0a'],
  ['Shock White', '#ffffff'],
  ['Flame Red', '#d62226'],
  ['Hazard Orange', '#ff6600'],
  ['Signal Yellow', '#ffd200'],
  ['Electric Lime', '#84cc16'],
  ['Deep Marine Blue', '#1d4ed8'],
  ['Royal Violet', '#7c3aed'],
  ['Rust Oxide', '#8b3a2b'],
];
const swatchBox = document.getElementById('swatches')!;
for (const [name, hex] of SWATCHES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = name;
  b.setAttribute('aria-label', name);
  b.style.setProperty('--swatch', hex);
  b.addEventListener('click', () => {
    b.blur();
    pickColor(hex);
  });
  swatchBox.append(b);
}

const sketchBtn = document.getElementById('sketch-btn') as HTMLButtonElement;

function toggleSketch(): void {
  if (mode !== 'none') return;
  sketchMode = !sketchMode;
  sketchBtn.setAttribute('aria-pressed', String(sketchMode));
  dirty = true;
}

sketchBtn.addEventListener('click', () => {
  sketchBtn.blur();
  toggleSketch();
});

const flashBtn = document.getElementById('flash-btn') as HTMLButtonElement;

function toggleFlashlight(): void {
  flashlight = !flashlight;
  flashBtn.setAttribute('aria-pressed', String(flashlight));
  dirty = true;
}

flashBtn.addEventListener('click', () => {
  flashBtn.blur();
  toggleFlashlight();
});

const stencilBtn = document.getElementById('stencil-btn') as HTMLButtonElement;
const stencilMenu = document.getElementById('stencil-menu')!;
const stencilKindBtns = document.querySelectorAll<HTMLButtonElement>('#stencil-menu [data-stencil]');
const stencilInvertBtn = document.getElementById('stencil-invert') as HTMLButtonElement;
const stencilAdjustBtn = document.getElementById('stencil-adjust') as HTMLButtonElement;
const stencilBakeBtn = document.getElementById('stencil-bake') as HTMLButtonElement;
const stencilHud = document.getElementById('stencil-hud')!;
const toolbarEl = document.getElementById('toolbar')!;
const hudAdjustBtn = document.getElementById('hud-adjust') as HTMLButtonElement;
const hudInvertBtn = document.getElementById('hud-invert') as HTMLButtonElement;
const stencilTextInput = document.getElementById('stencil-text') as HTMLInputElement;

function stencilTextValue(): string {
  return (
    stencilTextInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9 .!-]/g, '')
      .slice(0, 12)
      .trim() || 'TAG'
  );
}

stencilTextInput.addEventListener('input', () => {
  if (stencil?.kind !== 'text') return;
  stencil.text = stencilTextValue();
  markStencilChanged();
});

function updateStencilUI(): void {
  stencilKindBtns.forEach((b) => b.setAttribute('aria-pressed', String(stencil?.kind === b.dataset.stencil)));
  stencilInvertBtn.setAttribute('aria-pressed', String(!!stencil?.invert));
  stencilAdjustBtn.setAttribute('aria-pressed', String(stencilEdit));
  for (const b of [stencilInvertBtn, stencilAdjustBtn, stencilBakeBtn]) b.disabled = !stencil;
  stencilHud.hidden = !stencil;
  hudAdjustBtn.textContent = stencilEdit ? 'Done' : 'Move';
  hudAdjustBtn.setAttribute('aria-pressed', String(stencilEdit));
  hudInvertBtn.setAttribute('aria-pressed', String(!!stencil?.invert));
  markStencilChanged();
}

function setStencilMenu(open: boolean): void {
  stencilMenu.hidden = !open;
  stencilBtn.setAttribute('aria-expanded', String(open));
}

// Bake & Peel (button, B, Enter): fill the opening with the current color at the current
// opacity as one undo step, then lift the stencil.
function bakeStencil(): void {
  const s = stencil;
  if (!s || mode !== 'none' || locked()) return;
  ensureMask();
  const { hw, hh } = sheetHalf(s);
  const { ex, ey } = sheetExtents(s);
  const x0 = Math.floor(s.x - ex);
  const y0 = Math.floor(s.y - ey);
  const w = Math.max(1, Math.ceil(ex * 2) + 2);
  const h = Math.max(1, Math.ceil(ey * 2) + 2);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const k = cv.getContext('2d')!;
  k.translate(-x0, -y0);
  k.fillStyle = brush.color;
  inStencilFrame(k, s, () => k.fillRect(-hw, -hh, hw * 2, hh * 2));
  // Sheet ∩ allowed region = exactly the opening, for text and shapes alike.
  applyMaskTo(k, w, h, x0, y0);
  pushHistory();
  playPuff();
  paintCtx.globalAlpha = brush.opacity;
  paintCtx.drawImage(cv, x0, y0);
  paintCtx.globalAlpha = 1;
  stencil = null;
  stencilEdit = false;
  updateStencilUI();
  car().hasPaint = true;
  updateConsistUI();
  scheduleSave();
}

// ✕ Peel / Esc: lift the sheet only; whatever was sprayed through stays, no fill is added.
function peelStencil(): void {
  if (!stencil) return;
  playPeel();
  stencil = null;
  stencilEdit = false;
  updateStencilUI();
}

function toggleStencilEdit(): void {
  if (!stencil) return;
  stencilEdit = !stencilEdit;
  updateStencilUI();
}

stencilBtn.addEventListener('click', () => setStencilMenu(stencilMenu.hidden));
stencilKindBtns.forEach((b) =>
  b.addEventListener('click', () => {
    if (mode !== 'none') return;
    const kind = b.dataset.stencil as StencilKind;
    if (stencil) {
      stencil.kind = kind;
      stencil.text = stencilTextValue();
    } else {
      const [cx, cy] = screenToCar(window.innerWidth / 2, window.innerHeight / 2);
      stencil = {
        kind,
        x: Math.min(BODY.x + BODY.w - 200, Math.max(BODY.x + 200, cx)),
        y: Math.min(BODY.y + BODY.h - 200, Math.max(BODY.y + 200, cy)),
        size: 320,
        invert: false,
        text: stencilTextValue(),
        bw: 600,
        bh: 40,
        angle: 0,
      };
      stencilEdit = true;
      playPeel();
    }
    // Text keeps the picker open for typing; other shapes hand off to the on-stencil action pill.
    if (kind !== 'text') setStencilMenu(false);
    updateStencilUI();
  }),
);
function toggleStencilInvert(): void {
  if (stencil) stencil.invert = !stencil.invert;
  updateStencilUI();
}

stencilInvertBtn.addEventListener('click', toggleStencilInvert);
hudInvertBtn.addEventListener('click', toggleStencilInvert);
document.getElementById('hud-bake')!.addEventListener('click', bakeStencil);
stencilAdjustBtn.addEventListener('click', toggleStencilEdit);
hudAdjustBtn.addEventListener('click', toggleStencilEdit);
stencilBakeBtn.addEventListener('click', bakeStencil);
document.getElementById('hud-peel')!.addEventListener('click', peelStencil);
document.addEventListener('pointerdown', (e) => {
  const fly = (e.target as Element).closest('.flyout');
  if (!stencilMenu.hidden && fly !== stencilMenu.parentElement) setStencilMenu(false);
});
updateStencilUI();

document.getElementById('sketch-clear')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (mode !== 'none') return;
  sketchCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  sketchHas = false;
  dirty = true;
});

const TOOL_KEYS: Tool[] = ['spray', 'roller', 'mop', 'chisel', 'paintball', 'buff'];

function selectTool(tool: Tool): void {
  if (mode !== 'none') return;
  document.querySelector<HTMLButtonElement>(`#tools button[data-tool="${tool}"]`)?.click();
}

const sizeInput = document.getElementById('brush-size') as HTMLInputElement;

function nudgeSize(dir: 1 | -1): void {
  const v = Number(sizeInput.value);
  const step = v < 20 ? 2 : v < 60 ? 5 : 10;
  sizeInput.value = String(Math.min(Number(sizeInput.max), Math.max(Number(sizeInput.min), v + dir * step)));
  sizeInput.dispatchEvent(new Event('input'));
}

const helpDialog = document.getElementById('help-dialog') as HTMLDialogElement;

const dockToggle = document.getElementById('dock-toggle') as HTMLButtonElement;

function setDockCollapsed(collapsed: boolean): void {
  document.body.classList.toggle('dock-collapsed', collapsed);
  document.body.classList.remove('dock-tucked');
  dockToggle.setAttribute('aria-expanded', String(!collapsed));
}

dockToggle.addEventListener('click', () => {
  const hidden = document.body.classList.contains('dock-collapsed') || document.body.classList.contains('dock-tucked');
  setDockCollapsed(!hidden);
});
// Leaving compact landscape restores the full dock.
compactQuery.addEventListener('change', () => setDockCollapsed(false));

// ---------- Dock tooltips ----------
// Titles are promoted to data-tip on first use so the styled label replaces the slow native one.
const tip = document.getElementById('tip')!;
const LONG_PRESS_MS = 450;
let tipTimer = 0;
let pressTimer = 0;
let suppressClick = false;

const TIPS_KEY = 'graffiti_tooltips_enabled';
const tipsBtn = document.getElementById('tips-btn') as HTMLButtonElement;
let tipsEnabled = true;
try {
  tipsEnabled = localStorage.getItem(TIPS_KEY) !== 'false';
} catch {
  // Storage blocked (private mode etc.): fall back to the default.
}
tipsBtn.setAttribute('aria-pressed', String(tipsEnabled));
tipsBtn.addEventListener('click', () => {
  tipsEnabled = !tipsEnabled;
  tipsBtn.setAttribute('aria-pressed', String(tipsEnabled));
  if (!tipsEnabled) hideTip();
  try {
    localStorage.setItem(TIPS_KEY, String(tipsEnabled));
  } catch {
    // Preference just won't persist.
  }
});

function tipTarget(el: EventTarget | null): HTMLElement | null {
  const t = el instanceof Element ? (el.closest('[data-tip], [title]') as HTMLElement | null) : null;
  if (!t || !t.closest('#toolbar, #rollby-controls')) return null;
  if (t.title) {
    t.dataset.tip = t.title;
    t.removeAttribute('title');
  }
  return t.dataset.tip ? t : null;
}

function hideTip(): void {
  clearTimeout(tipTimer);
  tip.hidden = true;
}

function showTip(t: HTMLElement, hideAfter = 0): void {
  if (!tipsEnabled) return;
  tip.textContent = t.dataset.tip!;
  tip.hidden = false;
  const r = t.getBoundingClientRect();
  const w = tip.offsetWidth;
  tip.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
  clearTimeout(tipTimer);
  if (hideAfter) tipTimer = window.setTimeout(hideTip, hideAfter);
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse') return;
  const t = tipTarget(e.target);
  if (t) showTip(t);
  else hideTip();
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'mouse' && !e.relatedTarget) hideTip();
});
// Touch has no hover: long-press shows the label (and swallows that click); a plain tap flashes it.
document.addEventListener('pointerdown', (e) => {
  clearTimeout(pressTimer);
  if (e.pointerType === 'mouse') return hideTip();
  const t = tipTarget(e.target);
  if (!t || !tipsEnabled) return hideTip();
  pressTimer = window.setTimeout(() => {
    suppressClick = true;
    showTip(t);
  }, LONG_PRESS_MS);
});
document.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  clearTimeout(pressTimer);
  if (suppressClick) {
    tipTimer = window.setTimeout(hideTip, 1500);
    return;
  }
  const t = tipTarget(e.target);
  if (t) showTip(t, 1200);
});
document.addEventListener('pointercancel', () => clearTimeout(pressTimer));
document.addEventListener(
  'click',
  (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  },
  true,
);

function toggleHelp(): void {
  if (helpDialog.open) helpDialog.close();
  else helpDialog.showModal();
}

document.getElementById('reset-view')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  fitCamera(true);
});

document.getElementById('help-btn')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  toggleHelp();
});
// Clicks on the dialog element itself are backdrop clicks (content sits in an inner wrapper).
helpDialog.addEventListener('click', (e) => {
  if (e.target === helpDialog) helpDialog.close();
});

document.getElementById('clear-paint')!.addEventListener('click', () => {
  if (locked() || mode !== 'none') return;
  pushHistory();
  glazes.length = 0;
  paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  dirty = true;
  car().hasPaint = false;
  updateConsistUI();
  scheduleSave();
});

const toolButtons = document.querySelectorAll<HTMLButtonElement>('#tools button');
toolButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    brush.tool = btn.dataset.tool as Tool;
    if (brush.tool === 'spray') playShake();
    updateToolOptions();
    toolButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    dirty = true;
  }),
);

const capButtons = document.querySelectorAll<HTMLButtonElement>('#cap-options button');
const rollerButtons = document.querySelectorAll<HTMLButtonElement>('#roller-options button');
const capOptions = document.getElementById('cap-options')!;
const rollerOptions = document.getElementById('roller-options')!;
const straightLineToggle = document.getElementById('straight-line-toggle') as HTMLButtonElement;

straightLineToggle.addEventListener('click', () => {
  straightLineTool = !straightLineTool;
  straightLineToggle.setAttribute('aria-pressed', String(straightLineTool));
  straightLineToggle.blur();
});

function setCap(cap: Cap): void {
  brush.cap = cap;
  capButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cap === cap)));
  rebuildStamp();
  dirty = true;
}
capButtons.forEach((b) => b.addEventListener('click', () => setCap(b.dataset.cap as Cap)));

rollerButtons.forEach((b) =>
  b.addEventListener('click', () => {
    brush.roller = b.dataset.roller as RollerPreset;
    rollerButtons.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    dirty = true;
  }),
);

function updateToolOptions(): void {
  capOptions.hidden = brush.tool !== 'spray';
  rollerOptions.hidden = brush.tool !== 'roller';
}
updateToolOptions();

const focusBtn = document.getElementById('focus-btn') as HTMLButtonElement;
focusBtn.addEventListener('click', () => {
  const active = !document.body.classList.contains('focus-mode');
  document.body.classList.toggle('focus-mode', active);
  focusBtn.setAttribute('aria-pressed', String(active));
  focusBtn.setAttribute('aria-label', active ? 'Exit focus mode' : 'Focus mode');
  focusBtn.title = active ? 'Exit Focus – Restore full interface' : 'Focus – Maximize the canvas';
  fitCamera(true);
  dirty = true;
  focusBtn.blur();
});

const SPEAKER_PATH = '<path d="M4 9v6h4l5 4V5L8 9z"/>';
const SOUND_ON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${SPEAKER_PATH}<path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>`;
const SOUND_OFF_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true">${SPEAKER_PATH}<path d="M17 9l5 6M22 9l-5 6"/></svg>`;
const muteBtn = document.getElementById('mute-btn') as HTMLButtonElement;
let soundMuted = false;
function renderMute(): void {
  muteBtn.innerHTML = soundMuted ? SOUND_OFF_ICON : SOUND_ON_ICON;
  muteBtn.setAttribute('aria-pressed', String(soundMuted));
}
function toggleMute(): void {
  soundMuted = !soundMuted;
  setMuted(soundMuted);
  renderMute();
}
muteBtn.addEventListener('click', toggleMute);
renderMute();

const undoBtn = document.getElementById('undo') as HTMLButtonElement;
const redoBtn = document.getElementById('redo') as HTMLButtonElement;
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

function updateHistoryButtons(): void {
  undoBtn.disabled = locked() || !car().undo.length;
  redoBtn.disabled = locked() || !car().redo.length;
}
updateHistoryButtons();

const yardSelect = document.getElementById('yard-select') as HTMLSelectElement;

function setYardOptions(_practice: boolean): void {
  yardSelect.replaceChildren();
  for (const id of ['train', 'subway'] as YardId[]) yardSelect.add(new Option(YARDS[id].label, id));
  yardSelect.value = currentYard;
}
yardSelect.addEventListener('change', () => {
  switchYard(yardSelect.value as YardId);
  yardSelect.blur();
  updateConsistUI();
});

const carLabel = (i: number, hasPaint: boolean) => `Car ${String(i + 1).padStart(2, '0')}${hasPaint ? ' •' : ''}`;

function updateConsistUI(): void {
  yardSelect.value = currentYard;
  yardSelect.disabled = busy;
}
updateConsistUI();

// ---------- Auth & Ghost Yard sync ----------
const SAVE_DELAY = 2000;
// Firestore caps documents at 1 MiB.
const MAX_DOC_BYTES = 1_000_000;
const authBtn = document.getElementById('auth-btn') as HTMLButtonElement;
const userName = document.getElementById('user-name')!;
const saveStatus = document.getElementById('save-status')!;
let currentUser: User | null = null;
let saveTimer = 0;
let savePending = false;

function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveStatus.textContent = '';
  savePending = true;
  saveTimer = window.setTimeout(() => saveNow(), SAVE_DELAY);
}

// Saves a pending change immediately, before the paint layer is swapped to another car.
function flushSave(body?: HTMLCanvasElement): void {
  if (!savePending) return;
  clearTimeout(saveTimer);
  saveNow(body);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

const localKey = (yard: YardId, index: number) => `${yard}/${index}`;

// Always saves locally (lossless PNG); also syncs to Firestore when a user is signed in.
function saveNow(body: HTMLCanvasElement = copyBody()): void {
  savePending = false;
  if (practiceMode) {
    saveStatus.textContent = 'Practice · not saved';
    return;
  }
  const yard = currentYard;
  const index = currentCarIndex;
  const encode = (type: string, q?: number) => new Promise<Blob | null>((r) => body.toBlob(r, type, q));
  saveStatus.textContent = 'Saving…';
  void (async () => {
    try {
      const png = await encode('image/png');
      if (!png) throw new Error('Paint encode failed');
      await saveLocalCar(localKey(yard, index), png);
      const now = Date.now();
      const prevMeta = readMeta()[localKey(yard, index)];
      updateMeta(localKey(yard, index), { savedAt: now, createdAt: prevMeta?.createdAt ?? prevMeta?.savedAt ?? now });
      const webp = await encode('image/webp', 0.9);
      if (!webp) throw new Error('Paint encode failed');
      const dataUrl = await blobToDataUrl(webp);
      if (dataUrl.length > MAX_DOC_BYTES) {
        saveStatus.textContent = 'Too large';
        return;
      }
      const result = await publishPiece(dataUrl, prevMeta?.createdAt ?? now);
      saveStatus.textContent =
        result === 'no-account'
          ? 'Saved on this device only'
          : result === 'failed'
            ? 'Saved here – upload failed'
            : currentUser?.isAnonymous
              ? 'Saved · Sign in to keep your pieces'
              : 'Saved';
    } catch (err) {
      console.error('Save failed', err);
      saveStatus.textContent = 'Save failed';
    }
  })();
}

// ---------- The live piece: created on the first stroke, updated by every autosave ----------
// Remembers the piece to reopen next time PAINT is pressed.
const LAST_PIECE_KEY = 'graffbap_last_piece';
// id of the registry doc this session is writing to; null until the first save lands.
let currentPieceId: string | null = null;
let pieceBasedOn: { id: string; writer: string } | null = null;
let creatingPiece = false;

function resetPieceSession(): void {
  currentPieceId = null;
  pieceBasedOn = null;
}

function rememberPiece(id: string | null): void {
  if (id) localStorage.setItem(LAST_PIECE_KEY, id);
  else localStorage.removeItem(LAST_PIECE_KEY);
}

type PublishResult = 'published' | 'no-account' | 'failed';

async function publishPiece(image: string, createdAt: number): Promise<PublishResult> {
  const user = currentUser ?? (await ensureAnonymous().catch((err) => {
    console.error('Anonymous sign-in failed', err);
    return null;
  }));
  if (!user) return 'no-account';
  try {
    if (currentPieceId) {
      await updatePieceImage(currentPieceId, image);
      return 'published';
    }
    if (creatingPiece) return 'published';
    creatingPiece = true;
    try {
      currentPieceId = await registerDeparture({
        yard: currentYard,
        division: YARDS[currentYard].division,
        slot: currentCarIndex,
        writer: writerHandle(user),
        writerUid: user.uid,
        image,
        createdAt,
        ...(pieceBasedOn ? { basedOn: pieceBasedOn.id, basedOnWriter: pieceBasedOn.writer } : {}),
      });
    } finally {
      creatingPiece = false;
    }
    rememberPiece(currentPieceId);
    return 'published';
  } catch (err) {
    console.error('Publish failed', err);
    return 'failed';
  }
}

// Restores the last local save of the car in the editor.
async function fetchLocal(yard: YardId, index: number): Promise<void> {
  const c = yardConsists[yard][index]!;
  if (c.localState !== 'none') return;
  if (practiceMode) {
    c.localState = 'done';
    return;
  }
  c.localState = 'loading';
  const version = c.version;
  try {
    const blob = await loadLocalCar(localKey(yard, index));
    c.localState = 'done';
    if (!blob || c.version !== version) return;
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } finally {
      URL.revokeObjectURL(url);
    }
    if (c.version !== version) return;
    if (car() === c) {
      if (busy) {
        c.localState = 'none';
        return;
      }
      ++swapToken;
      swapPending = false;
      paintCtx.globalAlpha = 1;
      paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
      paintCtx.drawImage(img, BODY.x, BODY.y);
      dirty = true;
    } else {
      c.paint = snapshot(img);
    }
    c.hasPaint = hasVisiblePaint(img);
    updateConsistUI();
    updateHistoryButtons();
  } catch (err) {
    c.localState = 'none';
    console.error(`Local load failed for car ${index + 1}`, err);
  }
}

async function fetchRemote(_user: User, _index: number): Promise<void> {
  // Pieces live in the registry now; nothing device-side to restore.
}
void fetchRemote;

let noticeTimer = 0;

// Long notices float above the fixed-width status slot so the dock never reflows.
function showNotice(text: string): void {
  saveStatus.dataset.notice = text;
  clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => delete saveStatus.dataset.notice, 2500);
}

// Public docs are world-readable, so publish a handle rather than a full email address.
function writerHandle(user: User): string {
  return (user.displayName || user.email?.split('@')[0] || 'Anonymous').slice(0, 64);
}

// ---------- Roll-By ----------
const ROLL_SPEED = 900;
const ROLL_SPEEDS = [
  { label: 'Crawl 0.5x', rate: 0.5 },
  { label: 'Cruise 1x', rate: 1 },
  { label: 'Highball 2x', rate: 2 },
];
// Car-space rows shown in the widescreen frame: the car plus a strip of ballast.
const ROLL_VIEW_H = 1300;
// Widest a single car may render relative to the track, so a whole piece always fits on screen.
const CAR_FIT = 0.92;
// Other cars are decoded at reduced size so all 20 fit in memory.
const ROLL_RES = 0.35;
const ROLL_BITMAP: ImageBitmapOptions = {
  resizeWidth: Math.round(BODY.w * ROLL_RES),
  resizeHeight: Math.round(BODY.h * ROLL_RES),
  resizeQuality: 'medium',
};

interface RollState {
  x: number;
  speedIdx: number;
  paused: boolean;
  lastT: number;
  images: (CanvasImageSource | null)[];
  token: number;
  viewCar: number;
  // Showcase reel (gallery view) vs the editor's Roll-By preview.
  showcase: boolean;
  // Reel line-up (Mainline or one yard's line); null = the editor's own consist.
  entries: RollEntry[] | null;
}

interface RollEntry {
  // 'preset' = built-in community piece standing in until real cars are rated.
  yard: YardId | 'preset';
  index: number;
  writer: string;
  props: number;
  // Preset standing in on the subway reel, so it wears a subway body.
  sub?: boolean;
  // Set for departed cars from the global registry (image, status and votes live there).
  reg?: RegistryCar;
  archiveImage?: string;
}

const rollCount = (r: RollState) => r.entries?.length ?? CAR_COUNT;
let roll: RollState | null = null;
let rollToken = 0;

const rollControls = document.getElementById('rollby-controls')!;
const rollCarLabel = document.getElementById('rollby-car')!;
const rollPlayBtn = document.getElementById('rollby-play') as HTMLButtonElement;
const rollSpeedBtn = document.getElementById('rollby-speed') as HTMLButtonElement;

function rollLayout(W = window.innerWidth, H = window.innerHeight) {
  const contentH = Math.min(H, W / 2.39);
  const scale = Math.min(contentH / ROLL_VIEW_H, (W * CAR_FIT) / CAR_WIDTH);
  return { W, H, bar: (H - ROLL_VIEW_H * scale) / 2, scale };
}

// The landing reel renders into its framed canvas; the editor's Roll-By uses the full viewport.
function activeRollLayout(showcase = !!roll?.showcase) {
  return showcase
    ? rollLayout(Math.max(1, showcaseCanvas.clientWidth), Math.max(1, showcaseCanvas.clientHeight))
    : rollLayout();
}

function rollBitmap(src: HTMLImageElement | HTMLCanvasElement | Blob): Promise<ImageBitmap> {
  if (!(src instanceof Blob) && src.width !== BODY.w) {
    return createImageBitmap(src, BODY.x, BODY.y, BODY.w, BODY.h, ROLL_BITMAP);
  }
  return createImageBitmap(src, ROLL_BITMAP);
}

async function loadCarBitmap(i: number): Promise<ImageBitmap | null> {
  const c = consist[i]!;
  try {
    await fetchLocal(currentYard, i);
    const src = c.paint ? (c.paint.canvas ?? (await c.paint.blob)) : null;
    return src ? await rollBitmap(src) : null;
  } catch (err) {
    console.error(`Car ${i + 1} image load failed`, err);
    return null;
  }
}

async function loadRollImage(i: number, token: number): Promise<void> {
  const bmp = await loadCarBitmap(i);
  if (bmp && roll?.token === token) roll.images[i] = bmp;
}

async function loadEntryImage(e: RollEntry, i: number, token: number): Promise<void> {
  const img = await entryImage(e);
  if (img && roll?.token === token) roll.images[i] = img;
}

async function entryImage(e: RollEntry): Promise<CanvasImageSource | null> {
  try {
    let img: CanvasImageSource | null = null;
    if (e.reg) {
      img = await rollBitmap(await decodeDataUrl(e.reg.image));
    } else if (e.archiveImage) {
      img = await rollBitmap(await decodeDataUrl(e.archiveImage));
    } else if (e.yard === 'preset') {
      img = presetPiece(e.index);
    } else {
      await fetchLocal(e.yard, e.index);
      const c = yardConsists[e.yard][e.index]!;
      // The car open in the editor lives in paintLayer, not in its stored snapshot.
      if (c === car()) {
        if (c.hasPaint) img = await rollBitmap(copyBody());
      } else if (c.paint) {
        const src = c.paint.canvas ?? (await c.paint.blob);
        if (src) img = await rollBitmap(src);
      }
    }
    return img;
  } catch (err) {
    console.error('Reel car load failed', err);
    return null;
  }
}

function updateRollControls(): void {
  if (!roll) return;
  const play = roll.paused ? '&#x25B6;' : '&#x23F8;';
  const playLabel = roll.paused ? 'Play' : 'Pause';
  const speed = `${ROLL_SPEEDS[roll.speedIdx]!.rate}x`;
  for (const button of [rollPlayBtn, scPlayBtn]) {
    button.innerHTML = play;
    button.setAttribute('aria-label', playLabel);
    button.title = playLabel;
  }
  for (const button of [rollSpeedBtn, scSpeedBtn]) {
    button.textContent = speed;
    button.title = `Speed ${speed}`;
  }
}

function enterRollBy(showcase = false, entries: RollEntry[] | null = null): void {
  if (roll || mode !== 'none' || locked()) return;
  finishDrips();
  const token = ++rollToken;
  const L = activeRollLayout(showcase);
  roll = {
    // The landing reel rolls eastbound (left-to-right), so it starts just past the train's end.
    x: showcase ? (entries?.length ?? CAR_COUNT) * CAR_WIDTH : -L.W / L.scale,
    speedIdx: 1,
    paused: false,
    lastT: performance.now(),
    images: new Array<CanvasImageSource | null>(CAR_COUNT).fill(null),
    token,
    viewCar: -1,
    showcase,
    entries,
  };
  if (entries) {
    entries.forEach((e, i) => void loadEntryImage(e, i, token));
  } else {
    for (let i = 0; i < CAR_COUNT; i++) if (i !== currentCarIndex) void loadRollImage(i, token);
  }
  document.body.classList.add('rollby');
  document.body.classList.toggle('showcase', showcase);
  rollControls.hidden = showcase;
  viewport.style.cursor = 'pointer';
  updateRollControls();
  // The landing reel stays silent until its sound toggle is switched on.
  if (!showcase) startClatter(1);
}

// Returns to the editor on `target`, or on the car currently in view.
function exitRollBy(target?: number): void {
  if (!roll) return;
  const index = target ?? roll.viewCar;
  roll = null;
  rollToken++;
  baseCache.clear();
  stopClatter();
  document.body.classList.remove('rollby', 'showcase');
  rollControls.hidden = true;
  showCard(-1);
  updateCursor();
  dirty = true;
  if (index >= 0 && index < CAR_COUNT) switchCar(index);
}

function toggleRollPause(): void {
  if (!roll) return;
  roll.paused = !roll.paused;
  if (!roll.paused) {
    reelSel.top.pinned = null;
    if (cardSrc === 'top') showCard(-1, 'top');
  }
  if (roll.showcase) return;
  if (roll.paused) stopClatter();
  else startClatter(ROLL_SPEEDS[roll.speedIdx]!.rate);
  updateRollControls();
}

function cycleRollSpeed(): void {
  if (!roll) return;
  roll.speedIdx = (roll.speedIdx + 1) % ROLL_SPEEDS.length;
  if (!roll.showcase) setClatterRate(ROLL_SPEEDS[roll.speedIdx]!.rate);
  updateRollControls();
}

document.getElementById('rollby-btn')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  enterRollBy();
});
// Blur after click so Space toggles via the key handler, not a focused button.
rollPlayBtn.addEventListener('click', () => {
  rollPlayBtn.blur();
  toggleRollPause();
});
rollSpeedBtn.addEventListener('click', () => {
  rollSpeedBtn.blur();
  cycleRollSpeed();
});
document.getElementById('rollby-exit')!.addEventListener('click', () => exitRollBy());

// Closed knuckle coupler, lift pin and sagging air hoses at a car boundary.
function drawKnuckle(ctx: CanvasRenderingContext2D, x: number): void {
  ctx.fillStyle = '#141414';
  ctx.fillRect(x - 40, 954, 80, 54);
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath();
  ctx.moveTo(x + 3, 981);
  ctx.arc(x - 14, 981, 17, 0, TAU);
  ctx.moveTo(x + 31, 981);
  ctx.arc(x + 14, 981, 17, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#4a4a4a';
  ctx.fillRect(x - 3, 944, 6, 74);
  ctx.strokeStyle = '#0d0d0d';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x - 70, 1004);
  ctx.quadraticCurveTo(x, 1045, x + 70, 1004);
  ctx.stroke();
}

function renderRollBy(now: number): void {
  const r = roll!;
  const ctx = r.showcase ? showcaseCtx : viewCtx;
  // The scrolling reels render every frame, so they run at capped density.
  const px = r.showcase ? reelDpr() : dpr;
  if (r.showcase) sizeShowcaseCanvas();
  const L = activeRollLayout();
  const dt = Math.min(0.1, (now - r.lastT) / 1000);
  r.lastT = now;
  if (!r.paused) r.x += (r.showcase ? -1 : 1) * ROLL_SPEED * ROLL_SPEEDS[r.speedIdx]!.rate * dt;
  // Loop: once the last car clears, the train re-enters from the right.
  if (r.x > rollCount(r) * CAR_WIDTH) r.x = -L.W / L.scale;
  else if (r.x < -L.W / L.scale) r.x = rollCount(r) * CAR_WIDTH;

  const rc = { x: -r.x * L.scale, y: L.bar, scale: L.scale };
  drawBackdrop(ctx, r.showcase ? { x: 0, y: rc.y, scale: rc.scale } : rc, px, L.W, L.H);

  const s = px * L.scale;
  const first = Math.max(0, Math.floor(r.x / CAR_WIDTH));
  const last = Math.min(rollCount(r) - 1, Math.floor((r.x + L.W / L.scale) / CAR_WIDTH));
  for (let i = first; i <= last; i++) {
    ctx.setTransform(s, 0, 0, s, px * (rc.x + i * CAR_WIDTH * L.scale), px * rc.y);
    if (!r.entries && i === currentCarIndex) {
      drawCarComposite(ctx, baseIdFor(currentYard, i), paintLayer, true);
    } else {
      const e = r.entries?.[i];
      drawCarComposite(ctx, e ? entryBaseId(e) : baseIdFor(currentYard, i), r.images[i] ?? null, false);
    }
    if (i > 0) drawKnuckle(ctx, 0);
  }

  ctx.setTransform(px, 0, 0, px, 0, 0);
  if (r.showcase) {
    drawCrossing(ctx, L, rc.y, now);
    trackSelection(ctx, 'top', rollCount(r), (i) => rc.x + i * CAR_WIDTH * L.scale, L.scale, rc.y, L.W);
  }
  // The landing reel lets the yard fill its frame; only the cinematic Roll-By gets letterboxed.
  if (!r.showcase) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, L.W, L.bar);
    ctx.fillRect(0, L.H - L.bar, L.W, L.bar + 1);
  }

  const center = Math.floor((r.x + L.W / 2 / L.scale) / CAR_WIDTH);
  const viewCar = !r.entries && center >= 0 && center < CAR_COUNT ? center : -1;
  if (viewCar !== r.viewCar) {
    r.viewCar = viewCar;
    rollCarLabel.textContent =
      viewCar < 0 ? 'Car — / 20' : `${carLabel(viewCar, consist[viewCar]!.hasPaint)} / 20`;
  }
  positionCarCard();
}

// ---------- Showcase (gallery) ----------
const showcaseCanvas = document.getElementById('showcase-canvas') as HTMLCanvasElement;
// Opaque context: the backdrop covers every pixel, and skipping alpha saves compositing.
const showcaseCtx = showcaseCanvas.getContext('2d', { alpha: false })!;
const scPlayBtn = document.getElementById('sc-play') as HTMLButtonElement;
const scSpeedBtn = document.getElementById('sc-speed') as HTMLButtonElement;

function sizeShowcaseCanvas(): void {
  const d = reelDpr();
  const w = Math.max(1, Math.round(showcaseCanvas.clientWidth * d));
  const h = Math.max(1, Math.round(showcaseCanvas.clientHeight * d));
  if (showcaseCanvas.width !== w) showcaseCanvas.width = w;
  if (showcaseCanvas.height !== h) showcaseCanvas.height = h;
}
const carCard = document.getElementById('car-card')!;
const ccTally = carCard.querySelector('.cc-tally') as HTMLElement;
const ccPreview = document.getElementById('cc-preview') as HTMLCanvasElement;
const ccDate = carCard.querySelector('.cc-date')!;
const ccBy = carCard.querySelector('.cc-by') as HTMLElement;
const ccPropsBtn = document.getElementById('cc-props') as HTMLButtonElement;
const ccToyBtn = document.getElementById('cc-toy') as HTMLButtonElement;
const ccReportBtn = document.getElementById('cc-report') as HTMLButtonElement;
const ccCloseBtn = document.getElementById('cc-close') as HTMLButtonElement;
const ccPaintBtn = document.getElementById('cc-paint') as HTMLButtonElement;
const PENCIL_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 7l3 3"/></svg>';
const SPRAY_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="9" width="8" height="13" rx="1.5"/><path d="M9 9V6h4v3M10 6V4h2"/><path d="M18 5h1M20.5 3.2l.8-.8M20.5 7l.8.8"/></svg>';

// Editing your own piece and starting a copy of someone else's must never look the same.
function renderPaintBtn(mine: boolean): void {
  ccPaintBtn.classList.toggle('is-mine', mine);
  ccPaintBtn.querySelector('.cc-paint-icon')!.innerHTML = mine ? PENCIL_SVG : SPRAY_SVG;
  ccPaintBtn.querySelector('.cc-paint-label')!.textContent = mine ? 'Edit My Car' : 'Use This Car';
  ccPaintBtn.title = mine ? 'Edit \u2013 keep painting your own piece' : 'Use This Car \u2013 start a new piece from this one';
  ccPaintBtn.setAttribute('aria-label', mine ? 'Edit my car' : 'Use this car as the base for a new piece');
}
const ccPropsCount = document.getElementById('cc-props-count')!;
let cardCar = -1;

const PRESET_WORDS = ['BAP', 'GHOST', 'NYTE', 'RUST', 'DUST', 'SKEME', 'YARD'];
const PRESET_WRITERS = ['BAPX Crew', 'Ghost One', 'Nyte Owl', 'Rust Belt', 'Dust Devil', 'Skeme', 'Yard Dog'];
const PRESET_COLORS: [string, string][] = [
  ['#ffd200', '#ff6600'],
  ['#84cc16', '#1d4ed8'],
  ['#e8ecef', '#8b3a2b'],
  ['#7c3aed', '#d62226'],
  ['#ff6600', '#d62226'],
];

// Local-only car metadata: save time and mocked props, keyed like the IndexedDB paint saves.
const META_KEY = 'graffbap_car_meta';
type CarMeta = { savedAt?: number; props?: number; toys?: number; createdAt?: number; buffed?: boolean; burnStart?: number };

function readMeta(): Record<string, CarMeta> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(META_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, CarMeta>) : {};
  } catch {
    return {};
  }
}

function updateMeta(key: string, patch: CarMeta): CarMeta {
  const all = readMeta();
  const m = { ...all[key], ...patch };
  all[key] = m;
  try {
    localStorage.setItem(META_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: props still count for this session via the returned value.
  }
  return m;
}

// Pre-baked throw-up for empty cars, at Roll-By resolution in body space.
function presetPiece(i: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(BODY.w * ROLL_RES);
  c.height = Math.round(BODY.h * ROLL_RES);
  const k = c.getContext('2d')!;
  k.scale(ROLL_RES, ROLL_RES);
  const r = seededRandom(500 + i);
  const word = PRESET_WORDS[i % PRESET_WORDS.length]!;
  const [top, bottom] = PRESET_COLORS[i % PRESET_COLORS.length]!;
  const f = BODY.h * 0.55;
  k.font = `900 ${f}px Impact, "Arial Black", sans-serif`;
  k.textAlign = 'center';
  k.textBaseline = 'middle';
  k.lineJoin = 'round';
  k.translate(BODY.w * (0.35 + r() * 0.3), BODY.h * 0.5);
  k.rotate((r() - 0.5) * 0.12);
  k.fillStyle = '#111';
  for (let d = 10; d > 0; d--) k.fillText(word, d * 3, d * 3);
  k.lineWidth = f * 0.12;
  k.strokeStyle = '#0a0a0a';
  k.strokeText(word, 0, 0);
  const g = k.createLinearGradient(0, -f / 2, 0, f / 2);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  k.fillStyle = g;
  k.fillText(word, 0, 0);
  k.lineWidth = f * 0.015;
  k.strokeStyle = 'rgba(255,255,255,0.7)';
  k.strokeText(word, -f * 0.02, -f * 0.02);
  k.fillStyle = bottom;
  for (let d = 0; d < 5; d++) k.fillRect((r() - 0.5) * f * 2, f * 0.4, 6 + r() * 6, 30 + r() * 120);
  return c;
}

// Rail-crossing signal in the foreground of the reel: crossbuck and alternating red lamps.
function drawCrossing(
  ctx: CanvasRenderingContext2D,
  L: ReturnType<typeof rollLayout>,
  oy: number,
  now: number,
): void {
  const s = L.scale;
  const x = L.W * 0.08;
  const ground = oy + GROUND_Y * s;
  const topY = ground - 900 * s;
  ctx.fillStyle = '#2b2d31';
  ctx.fillRect(x - 9 * s, topY, 18 * s, ground - topY);
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    ctx.save();
    ctx.translate(x, topY + 60 * s);
    ctx.rotate(a);
    ctx.fillStyle = '#111';
    ctx.fillRect(-190 * s, -34 * s, 380 * s, 68 * s);
    ctx.fillStyle = '#f2f2ee';
    ctx.fillRect(-184 * s, -28 * s, 368 * s, 56 * s);
    ctx.restore();
  }
  const armY = topY + 260 * s;
  ctx.fillStyle = '#1b1c1f';
  ctx.fillRect(x - 120 * s, armY - 8 * s, 240 * s, 16 * s);
  const lit = Math.floor(now / 500) % 2;
  [-80, 80].forEach((dx, n) => {
    const lx = x + dx * s;
    ctx.fillStyle = '#0c0c0c';
    ctx.beginPath();
    ctx.arc(lx, armY + 44 * s, 44 * s, 0, TAU);
    ctx.fill();
    const on = n === lit;
    ctx.fillStyle = on ? '#ff2a1a' : '#3a0a08';
    ctx.beginPath();
    ctx.arc(lx, armY + 44 * s, 30 * s, 0, TAU);
    ctx.fill();
    if (!on) return;
    const glow = ctx.createRadialGradient(lx, armY + 44 * s, 0, lx, armY + 44 * s, 200 * s);
    glow.addColorStop(0, 'rgba(255,60,30,0.45)');
    glow.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(lx - 200 * s, armY + 44 * s - 200 * s, 400 * s, 400 * s);
  });
}

const presetBaseProps = (k: number) => 12 + ((k * 37) % 48);
const entryAt = (i: number): RollEntry | null => roll?.entries?.[i] ?? null;
const entryKey = (e: RollEntry) =>
  e.reg ? `reg/${e.reg.id}` : e.yard === 'preset' ? `preset/${e.index}` : localKey(e.yard, e.index);
const entryOrigin = (e: RollEntry) => {
  if (e.yard === 'preset') return 'Community Line';
  const tag = e.reg?.status === 'hall_of_fame' ? ' · Hall of Fame' : e.reg?.status === 'museum' ? ' · Museum' : '';
  return YARDS[e.yard].label + tag;
};

function entryProps(e: RollEntry, meta: Record<string, CarMeta>): number {
  if (e.reg) return e.reg.props;
  return (meta[entryKey(e)]?.props ?? 0) + (e.yard === 'preset' ? presetBaseProps(e.index) : 0);
}

function entryToys(e: RollEntry, meta: Record<string, CarMeta>): number {
  return e.reg ? e.reg.toys : (meta[entryKey(e)]?.toys ?? 0);
}

function entryWriter(e: RollEntry): string | null {
  if (e.reg) return e.reg.writer || 'Anonymous';
  if (e.yard === 'preset') return e.writer;
  return yardConsists[e.yard][e.index]!.hasPaint ? 'Anonymous Freight' : null;
}

// Legacy docs carry retired yard ids, so the surface comes from the division.
const regEntry = (c: RegistryCar): RollEntry | null =>
  c.image ? { yard: surfaceFor(c.division), index: c.slot, writer: c.writer || 'Anonymous', props: c.props, reg: c } : null;

type SortMode = FeedSort;

function yardWeight(_yard: YardId | 'preset'): number {
  return 1;
}

// Net Props (props − toys) ordering for line-ups that don't come from the registry query.
function sortEntries<T>(items: T[], entryOf: (t: T) => RollEntry, mode: SortMode): T[] {
  const meta = readMeta();
  const net = (t: T) => {
    const e = entryOf(t);
    return (entryProps(e, meta) - entryToys(e, meta)) * yardWeight(e.yard);
  };
  if (mode === 'random') {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
  if (mode === 'latest' || mode === 'oldest') {
    return items.sort((a, b) => {
      const aa = entryOf(a).reg?.createdAt ?? meta[entryKey(entryOf(a))]?.createdAt ?? meta[entryKey(entryOf(a))]?.savedAt ?? 0;
      const bb = entryOf(b).reg?.createdAt ?? meta[entryKey(entryOf(b))]?.createdAt ?? meta[entryKey(entryOf(b))]?.savedAt ?? 0;
      return mode === 'latest' ? bb - aa : aa - bb;
    });
  }
  return items.sort((a, b) => (mode === 'top' ? net(b) - net(a) : net(a) - net(b)));
}
void sortEntries;

// ---------- Reel car selection: bracketed on the canvas, read out + voted from the car card ----------
type ReelId = 'top' | 'sub';
interface ReelSel {
  // Car the viewer clicked; null = follow the car nearest the middle of the track.
  pinned: number | null;
  active: number;
  entryAt: (i: number) => RollEntry | null;
  rankBadge: string | null;
}
const leaderboardRanks: Record<string, string> = {};
void leaderboardRanks;
const reelSel: Record<ReelId, ReelSel> = {
  top: {
    pinned: null,
    active: -2,
    entryAt: (i) => entryAt(i),
    rankBadge: null,
  },
  sub: {
    pinned: null,
    active: -2,
    entryAt: (i) => subwayReel.entries[i] ?? null,
    rankBadge: null,
  },
};

function resetReelSel(id: ReelId): void {
  reelSel[id].pinned = null;
  reelSel[id].active = -2;
  reelSel[id].rankBadge = null;
}

// Registry cars, presets and archive hits always carry a piece; yard cars count once paint is saved.
function entryPainted(e: RollEntry): boolean {
  return !!e.reg || e.yard === 'preset' || !!e.writer || yardConsists[e.yard][e.index]!.hasPaint;
}

const LOCAL_REPORTS_KEY = 'graffbap_local_reports';
function hasReported(id: string): boolean {
  try {
    const reports = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) ?? '{}') as Record<string, boolean>;
    return !!reports[`${currentUser?.uid ?? 'guest'}|${id}`];
  } catch {
    return false;
  }
}

function markReported(id: string): void {
  let reports: Record<string, boolean> = {};
  try {
    reports = JSON.parse(localStorage.getItem(LOCAL_REPORTS_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    reports = {};
  }
  reports[`${currentUser?.uid ?? 'guest'}|${id}`] = true;
  localStorage.setItem(LOCAL_REPORTS_KEY, JSON.stringify(reports));
}

function renderReelBar(id: ReelId): void {
  if (cardSrc === id && cardCar >= 0) refreshCard();
}

// Resolves the active car (clicked, else nearest the track's middle) and draws its bracket.
function trackSelection(
  ctx: CanvasRenderingContext2D,
  id: ReelId,
  count: number,
  carX: (i: number) => number,
  scale: number,
  oy: number,
  W: number,
): void {
  const s = reelSel[id];
  const cw = CAR_WIDTH * scale;
  const onScreen = (i: number) => i >= 0 && i < count && carX(i) < W && carX(i) + cw > 0;
  if (s.pinned !== null && !onScreen(s.pinned)) s.pinned = null;
  const mid = Math.round((W / 2 - carX(0)) / cw - 0.5);
  const nearest = Math.min(count - 1, Math.max(0, mid));
  const active = s.pinned ?? (onScreen(nearest) ? nearest : -1);
  if (active !== s.active) {
    s.active = active;
    renderReelBar(id);
  }
  if (active < 0) return;
  const x0 = carX(active) + (BODY.x - 20) * scale;
  const x1 = carX(active) + (BODY.x + BODY.w + 20) * scale;
  const y0 = oy + (BODY.y - 60) * scale;
  const y1 = oy + (BODY.y + BODY.h + 40) * scale;
  const arm = Math.min(12, (x1 - x0) / 8, (y1 - y0) / 4);
  ctx.save();
  // A clicked car holds the spotlight: everything either side of it drops back.
  if (s.pinned !== null) {
    const H = ctx.canvas.height / dpr;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, Math.max(0, x0), H);
    ctx.fillRect(Math.min(W, x1), 0, Math.max(0, W - x1), H);
  }
  // Faint rail-bed glow under the trucks.
  const railY = oy + 1142 * scale;
  const glow = ctx.createRadialGradient((x0 + x1) / 2, railY, 0, (x0 + x1) / 2, railY, (x1 - x0) / 2);
  glow.addColorStop(0, 'rgba(255,210,0,0.22)');
  glow.addColorStop(1, 'rgba(255,210,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x0, railY - 14 * scale - 6, x1 - x0, 28 * scale + 12);
  ctx.strokeStyle = 'rgba(255,210,0,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x0, y1, 1, -1],
    [x1, y1, -1, -1],
  ] as const) {
    ctx.moveTo(cx + dx * arm, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + dy * arm);
  }
  ctx.stroke();
  ctx.restore();
}

for (const id of ['top', 'sub'] as const) {
  document.getElementById(id === 'top' ? 'sc-sort' : 'sub-sort')!.addEventListener('change', (ev) => {
    const mode = (ev.currentTarget as HTMLSelectElement).value as SortMode;
    if (id === 'top') {
      topSort = mode;
      void startMainline();
    } else {
      subSort = mode;
      loadSubwayLine(subwayReel.yard);
    }
  });
}

// The "Currently painting" option only opens up while someone actually has a can on a car.
async function refreshPaintingOption(): Promise<void> {
  for (const [sel, division] of [
    ['sc-sort', 'freight'],
    ['sub-sort', 'subway'],
  ] as const) {
    const option = document.querySelector<HTMLOptionElement>(`#${sel} option[value="painting"]`);
    if (!option) continue;
    let count = 0;
    try {
      count = await countPainting(division);
    } catch (err) {
      console.error('Painting count failed', err);
    }
    option.disabled = count === 0;
    option.textContent = count ? `Currently painting (${count})` : 'Currently painting';
  }
}
void refreshPaintingOption();
setInterval(() => void refreshPaintingOption(), 60_000);

let topSort: SortMode = 'top';
let subSort: SortMode = 'top';

function reloadReel(id: ReelId): void {
  if (id === 'sub') loadSubwayLine(subwayReel.yard);
  else void startMainline();
}

function reportEntry(e: RollEntry, id: ReelId): void {
  const reg = e.reg;
  if (!currentUser) return requireAuth(() => reportEntry(e, id), true);
  if (!entryPainted(e)) return;
  if (!reg) {
    markReported(entryKey(e));
    renderReelBar(id);
    showToast('Report sent – thanks for keeping the line clean.');
    return;
  }
  void reportRegistryCar(reg.id, currentUser.uid)
    .then((res) => {
      if (res === 'already') showToast('You already reported this car.');
      else if (res === 'reported') showToast('Report sent – thanks for keeping the line clean.');
      else {
        showToast('Car quarantined and pulled from the tracks.');
        reloadReel(id);
      }
      markReported(reg.id);
      renderReelBar(id);
    })
    .catch((err) => {
      console.error('Report failed', err);
      showToast('Report did not go through');
    });
}

function rollCarAt(sx: number, sy: number): number {
  if (!roll) return -1;
  const L = activeRollLayout();
  const wx = roll.x + sx / L.scale;
  const wy = (sy - L.bar) / L.scale;
  const i = Math.floor(wx / CAR_WIDTH);
  return i >= 0 && i < rollCount(roll) && wy >= 0 && wy <= ROLL_VIEW_H ? i : -1;
}

// The info card serves both reels; `cardSrc` says which reel's line-up `cardCar` indexes.
let cardSrc: 'top' | 'sub' = 'top';
const cardEntryAt = (i: number): RollEntry | null => {
  if (cardSrc === 'sub') return subwayReel.entries[i] ?? null;
  return entryAt(i) ?? (i >= 0 && i < CAR_COUNT
    ? { yard: 'preset', index: i, writer: PRESET_WRITERS[i % PRESET_WRITERS.length]!, props: presetBaseProps(i) }
    : null);
};

function showCard(i: number, src: 'top' | 'sub' = 'top'): void {
  if (i === cardCar && src === cardSrc) return;
  const previousFrame = document.getElementById(cardSrc === 'sub' ? 'subway-frame' : 'showcase-frame');
  previousFrame?.classList.remove('has-selection');
  cardSrc = src;
  const e = cardEntryAt(i);
  cardCar = e ? i : -1;
  carCard.hidden = !e;
  const frame = document.getElementById(src === 'sub' ? 'subway-frame' : 'showcase-frame');
  frame?.classList.toggle('has-selection', !!e);
  if (!e) {
    carCard.style.left = '';
    carCard.style.top = '';
    return;
  }
  positionCarCard();
  renderCard(e);
}

function renderCard(e: RollEntry): void {
  const meta = readMeta();
  const m = meta[entryKey(e)] ?? {};
  const born = m.savedAt ?? e.reg?.createdAt ?? m.createdAt;
  ccDate.textContent = born
    ? `Painted ${new Date(born).toLocaleString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit', hour: 'numeric', minute: '2-digit' })}`
    : e.yard === 'preset'
      ? `Painted ${CAR_VARIANTS[e.index]!.built.replace('BLT ', '')}`
      : 'Not stamped yet';
  const writer = e.writer || entryWriter(e);
  ccBy.textContent = writer ? `by ${writer}` : '';
  ccBy.title = writer || '';
  const painted = entryPainted(e);
  const reported = !!e.reg && hasReported(e.reg.id);
  // A car touched in the last couple of minutes is still being worked on, so it can't be rated.
  const wip = !!e.reg && isBeingPainted(e.reg);
  const mine = !!e.reg?.writerUid && e.reg.writerUid === currentUser?.uid;
  ccPropsBtn.disabled = !painted || wip;
  ccToyBtn.disabled = !painted || wip;
  // Report always stays live so a car can't be held unreportable by painting on it.
  ccReportBtn.disabled = !painted || reported;
  ccReportBtn.title = reported ? 'Already reported' : 'Report this car to moderators';
  ccPaintBtn.hidden = !e.reg;
  renderPaintBtn(mine);
  ccPropsCount.textContent = String(entryProps(e, meta));
  renderRating(e, cardRatingUI);
  if (wip) ccTally.textContent = 'Being painted right now';
  if (e.reg?.basedOnWriter) ccBy.textContent = `${ccBy.textContent} · over ${e.reg.basedOnWriter}`;
  drawCardPreview(e);
}

// The full-screen phone panel shows the car itself, so there's no guessing which one you tapped.
function drawCardPreview(e: RollEntry): void {
  if (!mobileCard()) return;
  const w = Math.max(1, Math.round(ccPreview.clientWidth || carCard.clientWidth - 28));
  const scale = w / CAR_WIDTH;
  const h = Math.max(1, Math.round(EXPORT_CROP.h * scale));
  const d = Math.min(window.devicePixelRatio || 1, 2);
  ccPreview.width = Math.round(w * d);
  ccPreview.height = Math.round(h * d);
  ccPreview.style.height = `${h}px`;
  const ctx = ccPreview.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ccPreview.width, ccPreview.height);
  const s = d * scale;
  ctx.setTransform(s, 0, 0, s, 0, -EXPORT_CROP.y * s);
  const img = cardSrc === 'sub' ? subwayReel.images[cardCar] : roll?.images[cardCar];
  drawCarComposite(ctx, entryBaseId(e), img ?? null, false);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Keeps the open card in step with the reel's active car.
function refreshCard(): void {
  const e = cardCar >= 0 ? cardEntryAt(cardCar) : null;
  if (e) renderCard(e);
}

// Phones get a full-screen panel instead of a side gutter.
const mobileCard = () => window.matchMedia('(max-width: 700px)').matches;

// The selected-car panel sits in the gutter the reel track opens up, so it reads as part of the reel.
function positionCarCard(): void {
  if (cardCar < 0 || carCard.hidden) return;
  if (mobileCard()) {
    carCard.style.left = '';
    carCard.style.top = '';
    return;
  }
  const frame = document.getElementById(cardSrc === 'sub' ? 'subway-frame' : 'showcase-frame');
  const track = frame?.querySelector('.reel-track');
  if (!track) return;
  const bounds = track.getBoundingClientRect();
  carCard.style.left = `${bounds.right}px`;
  carCard.style.top = `${bounds.top}px`;
}

ccCloseBtn.addEventListener('click', () => {
  reelSel[cardSrc].pinned = null;
  showCard(-1, cardSrc);
});

ccReportBtn.addEventListener('click', () => {
  ccReportBtn.blur();
  const e = cardEntryAt(cardCar);
  if (e) reportEntry(e, cardSrc);
});

// Your own car reopens for editing; anyone else's starts a new piece using it as the base.
ccPaintBtn.addEventListener('click', () => {
  ccPaintBtn.blur();
  const reg = cardEntryAt(cardCar)?.reg;
  if (!reg) return;
  if (reg.status === 'hall_of_fame' && reg.writerUid === currentUser?.uid) {
    showToast('Hall of Fame pieces are locked.');
    return;
  }
  openPiece(reg, reg.writerUid === currentUser?.uid && !!reg.writerUid);
});

// Loads an existing piece into the editor, either to continue it or to paint over a copy.
function openPiece(reg: RegistryCar, edit: boolean): void {
  pendingPiece = { reg, edit };
  openSurface(surfaceFor(reg.division), false);
}

ccPropsBtn.addEventListener('click', () => {
  const e = cardEntryAt(cardCar);
  if (!e || !entryPainted(e)) return;
  castVote(e, 'props', () => {
    renderRating(e, cardRatingUI);
    popEls(ccPropsBtn, ccTally);
  });
});
ccToyBtn.addEventListener('click', () => {
  const e = cardEntryAt(cardCar);
  if (!e || !entryPainted(e)) return;
  castVote(e, 'toy', () => {
    renderRating(e, cardRatingUI);
    popEls(ccToyBtn);
  });
});

const VOTES_KEY = 'graffbap_votes';
const BUFF_GRACE_MS = 6 * 60 * 60_000;
const BUFF_MIN_VOTES = 10;
const BUFF_TOY_RATIO = 0.75;
type VoteKind = 'props' | 'toy';

interface RatingUI {
  props: Element;
  toys: Element;
  approval: Element;
  propsBtn: HTMLElement;
  toyBtn: HTMLElement;
}
const cardRatingUI: RatingUI = {
  props: ccPropsCount,
  toys: document.getElementById('cc-toy-count')!,
  approval: carCard.querySelector('.cc-approval')!,
  propsBtn: ccPropsBtn,
  toyBtn: ccToyBtn,
};

// Votes are keyed `${uid}|${carKey}`; older saves stored a timestamp, which meant props.
function readVotes(): Record<string, VoteKind | number> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VOTES_KEY) ?? '{}');
    return v && typeof v === 'object' ? (v as Record<string, VoteKind | number>) : {};
  } catch {
    return {};
  }
}

function myVote(key: string): VoteKind | null {
  if (!currentUser) return null;
  const v = readVotes()[`${currentUser.uid}|${key}`];
  return v === undefined ? null : v === 'toy' ? 'toy' : 'props';
}

function renderRating(e: RollEntry, ui: RatingUI): void {
  const key = entryKey(e);
  const meta = readMeta();
  const p = entryProps(e, meta);
  const t = entryToys(e, meta);
  const total = p + t;
  ui.props.textContent = String(p);
  ui.toys.textContent = String(t);
  ui.approval.textContent = total ? `${Math.round((p / total) * 100)}% approval · ${total} vote${total === 1 ? '' : 's'}` : 'No votes yet';
  const mine = myVote(key);
  ui.propsBtn.setAttribute('aria-pressed', String(mine === 'props'));
  ui.toyBtn.setAttribute('aria-pressed', String(mine === 'toy'));
}

// One vote per BoxBap.com profile per car (props OR toy); switching moves the vote. Recorded on this device.
function castVote(e: RollEntry, kind: VoteKind, done: () => void): void {
  if (!currentUser) {
    requireAuth(() => castVote(e, kind, done), true);
    return;
  }
  if (e.reg) return castRegistryVote(e, kind, done);
  const key = entryKey(e);
  const votes = readVotes();
  const voteKey = `${currentUser.uid}|${key}`;
  const prev = myVote(key);
  if (prev === kind) {
    showToast(kind === 'props' ? 'You already dropped props on this car.' : 'You already called this one whack.');
    done();
    return;
  }
  const m = readMeta()[key] ?? {};
  let props = m.props ?? 0;
  let toys = m.toys ?? 0;
  if (prev === 'props') props = Math.max(0, props - 1);
  if (prev === 'toy') toys = Math.max(0, toys - 1);
  if (kind === 'props') props++;
  else toys++;
  updateMeta(key, { props, toys });
  votes[voteKey] = kind;
  localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  if (!roll?.showcase) (kind === 'props' ? playPuff : playPeel)();
  done();
  if (shouldBuff(e)) buffEntry(e);
}

// Registry cars vote through Firestore so props, toys and HoF status are shared by every writer.
function castRegistryVote(e: RollEntry, kind: VoteKind, done: () => void): void {
  const reg = e.reg!;
  const uid = currentUser!.uid;
  void voteRegistryCar(reg.id, uid, kind)
    .then((r) => {
      e.reg = r.car;
      e.props = r.car.props;
      const votes = readVotes();
      votes[`${uid}|${entryKey(e)}`] = kind;
      localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
      if (r.already) showToast(kind === 'props' ? 'You already dropped props on this car.' : 'You already called this one whack.');
      else if (!roll?.showcase) (kind === 'props' ? playPuff : playPeel)();
      if (r.promoted) {
        showToast(`Hall of Fame – ${e.writer}'s piece just got inducted.`, 4000);
      }
      done();
    })
    .catch((err) => {
      console.error('Vote failed', err);
      showToast('Vote did not go through');
    });
}

async function decodeDataUrl(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

function shouldBuff(e: RollEntry): boolean {
  if (e.reg) return false;
  const meta = readMeta();
  const m = meta[entryKey(e)];
  if (m?.buffed) return false;
  const created = m?.createdAt ?? m?.savedAt ?? 0;
  if (Date.now() - created < BUFF_GRACE_MS) return false;
  const toys = m?.toys ?? 0;
  const total = entryProps(e, meta) + toys;
  return total >= BUFF_MIN_VOTES && toys / total >= BUFF_TOY_RATIO;
}

// Community buff: drop the car from rotation and return its slot to bare steel.
function buffEntry(e: RollEntry): void {
  const key = entryKey(e);
  updateMeta(key, { buffed: true, props: 0, toys: 0 });
  const votes = readVotes();
  for (const k of Object.keys(votes)) if (k.endsWith(`|${key}`)) delete votes[k];
  localStorage.setItem(VOTES_KEY, JSON.stringify(votes));
  if (e.yard !== 'preset') resetSlot(e.yard, e.index);
  showCard(-1);
  if (benchEntry && entryKey(benchEntry) === key) closeBench();
  showToast('The community called it whack – this car got buffed.');
  if (e.yard !== 'preset' && YARDS[e.yard].division === 'subway') loadSubwayLine(subwayReel.yard);
  else if (roll?.showcase) void startMainline();
}

function resetSlot(yard: YardId, index: number): void {
  const c = yardConsists[yard][index]!;
  if (c === car()) {
    finishDrips();
    glazes.length = 0;
    clearTimeout(saveTimer);
    savePending = false;
    paintCtx.globalAlpha = 1;
    paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
    dirty = true;
  }
  c.paint = null;
  c.undo.length = 0;
  c.redo.length = 0;
  c.hasPaint = false;
  c.version++;
  // Already reset locally; don't let a late fetch restore the old paint.
  c.localState = 'done';
  c.remoteState = 'done';
  updateConsistUI();
  updateHistoryButtons();
  void deleteLocalCars([localKey(yard, index)]).catch((err) => console.error('Local buff failed', err));
}

function popEls(...els: HTMLElement[]): void {
  for (const el of els) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }
}

scPlayBtn.addEventListener('click', () => {
  scPlayBtn.blur();
  toggleRollPause();
});
scSpeedBtn.addEventListener('click', () => {
  scSpeedBtn.blur();
  cycleRollSpeed();
});
document.getElementById('gallery-btn')!.addEventListener('click', () => {
  flushActiveCar();
  location.hash = '#gallery';
});

// ---------- Landing entry points ----------
const MAINLINE_SIZE = 16;
const reelTitle = document.getElementById('reel-title')!;
const reelDescription = document.getElementById('reel-description')!;
const subDescription = document.getElementById('sub-description')!;
const reelBackBtn = document.getElementById('reel-back') as HTMLButtonElement;
let pendingYard: YardId | null = null;
let pendingPractice = false;
// Set when a card sends an existing piece into the editor.
let pendingPiece: { reg: RegistryCar; edit: boolean } | null = null;
// Set when the viewer asked for blank steel rather than resuming whatever they last painted.
let pendingFresh = false;

function openSurface(yard: YardId, practice: boolean): void {
  pendingYard = yard;
  pendingPractice = practice;
  pendingFresh = true;
  const alreadyInYard = location.hash === '#yard';
  location.hash = '#yard';
  // No hashchange fires when the hash is unchanged, so drive the route directly.
  if (alreadyInYard) applyRoute();
}
// PAINT resumes the piece you were last on; only a first-timer gets a coin-flip surface.
async function resumeOrStartPainting(): Promise<void> {
  const lastId = localStorage.getItem(LAST_PIECE_KEY);
  if (lastId) {
    try {
      const reg = await getRegistryCar(lastId);
      if (reg && reg.status === 'departed' && reg.writerUid && reg.writerUid === currentUser?.uid) {
        openPiece(reg, true);
        return;
      }
    } catch (err) {
      console.error('Could not reopen your last piece', err);
    }
    localStorage.removeItem(LAST_PIECE_KEY);
  }
  openSurface(Math.random() < 0.5 ? 'train' : 'subway', false);
}
document.getElementById('paint-start')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  void resumeOrStartPainting();
});
document.getElementById('new-car')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  flushActiveCar();
  startFreshCar();
  showToast(practiceMode ? 'Fresh practice car' : 'Fresh steel \u2013 your last piece is on the line');
});
document.getElementById('delete-car')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (mode !== 'none' || busy) return;
  const live = practiceMode ? null : currentPieceId;
  const msg = live
    ? 'Delete this car? It comes off the line and the paint is gone for good.'
    : 'Wipe this car and start over?';
  if (!window.confirm(msg)) return;
  clearTimeout(saveTimer);
  savePending = false;
  if (live) {
    void retirePiece(live)
      .then(() => showToast('Car deleted \u2013 pulled off the line'))
      .catch((err) => {
        console.error('Delete failed', err);
        showToast('Could not delete that car');
      });
  }
  startFreshCar();
});

const presetEntries = (): RollEntry[] =>
  PRESET_WORDS.map((_, k) => ({ yard: 'preset' as const, index: k, writer: PRESET_WRITERS[k]!, props: presetBaseProps(k) })).filter(
    (e) => !readMeta()[entryKey(e)]?.buffed,
  );

// ---------- My Work: each reel filters its own line-up ----------
const myWorkBtns: Record<ReelId, HTMLButtonElement> = {
  top: document.getElementById('sc-mine') as HTMLButtonElement,
  sub: document.getElementById('sub-mine') as HTMLButtonElement,
};
const myWork: Record<ReelId, boolean> = { top: false, sub: false };

function renderMyWorkBtn(id: ReelId): void {
  const on = myWork[id];
  const btn = myWorkBtns[id];
  btn.setAttribute('aria-pressed', String(on));
  const show = document.createElement('span');
  show.className = 'mine-show';
  show.textContent = 'Show ';
  btn.replaceChildren(show, document.createTextNode(on ? 'All Work' : 'My Work'));
  btn.title = on ? 'Show every writer\u2019s cars' : 'Show only the cars you painted';
}

for (const id of ['top', 'sub'] as const) {
  myWorkBtns[id].addEventListener('click', () => {
    myWorkBtns[id].blur();
    myWork[id] = !myWork[id];
    renderMyWorkBtn(id);
    if (id === 'top') void startMainline();
    else loadSubwayLine(null);
  });
  renderMyWorkBtn(id);
}

async function buildMainline(): Promise<RollEntry[]> {
  if (myWork.top) {
    const uid = currentUser?.uid;
    if (!uid) return [];
    try {
      return (await listMine(uid, 'freight', MAINLINE_SIZE)).map(regEntry).filter((e): e is RollEntry => !!e);
    } catch (err) {
      console.error('My pieces feed failed', err);
      return [];
    }
  }
  try {
    const live = (await listFeed('freight', topSort, MAINLINE_SIZE)).map(regEntry).filter((e): e is RollEntry => !!e);
    if (live.length) return live;
  } catch (err) {
    console.error('Registry feed failed', err);
  }
  return presetEntries().map((e) => ({ ...e, props: entryProps(e, readMeta()) }));
}
function startReel(entries: RollEntry[], title: string, yardLine: boolean): void {
  if (roll && !roll.showcase) return;
  resetReelSel('top');
  reelTitle.textContent = title;
  reelBackBtn.hidden = !yardLine;
  // Leaving and re-entering would drop body.showcase for a frame and flash the landing page,
  // so an already-running reel just takes on the new line-up.
  if (roll) {
    const token = ++rollToken;
    roll.token = token;
    roll.entries = entries;
    roll.images = new Array<CanvasImageSource | null>(entries.length).fill(null);
    roll.viewCar = -1;
    roll.paused = false;
    roll.x = entries.length * CAR_WIDTH;
    if (cardSrc === 'top') showCard(-1, 'top');
    updateRollControls();
    entries.forEach((e, i) => void loadEntryImage(e, i, token));
    return;
  }
  enterRollBy(true, entries);
}

async function startMainline(): Promise<void> {
  const title = myWork.top ? 'My Trains' : 'Public Train Yard';
  reelDescription.textContent = 'Pulling the line-up…';
  startReel([], title, false);
  const entries = await buildMainline();
  if (roll?.showcase) {
    reelDescription.textContent = entries.length || !myWork.top ? '' : "You haven't painted any trains yet.";
    startReel(entries, title, false);
  }
}

reelBackBtn.addEventListener('click', () => void startMainline());

// Writes any unsaved strokes on the open car before the view changes or the tab goes away.
function flushActiveCar(): void {
  if (!swapPending) flushSave();
}
window.addEventListener('pagehide', flushActiveCar);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushActiveCar();
});
document.getElementById('back-dispatch')!.addEventListener('click', () => {
  flushActiveCar();
  location.hash = '#gallery';
});

const tosDialog = document.getElementById('tos-dialog') as HTMLDialogElement;
document.getElementById('tos-open')!.addEventListener('click', () => tosDialog.showModal());
document.getElementById('tos-close')!.addEventListener('click', () => tosDialog.close());
tosDialog.addEventListener('click', (e) => {
  if (e.target === tosDialog) tosDialog.close();
});
const landingAccountBtn = document.getElementById('landing-account') as HTMLButtonElement;
const writerIdEl = document.getElementById('writer-id')!;

// An anonymous session is an identity, not an account: it reads as signed-out everywhere.
const signedIn = () => !!currentUser && !currentUser.isAnonymous;

function renderAccount(): void {
  if (signedIn()) {
    landingAccountBtn.innerHTML = '<span class="acct-dot" aria-hidden="true"></span>';
    landingAccountBtn.append(writerHandle(currentUser!));
    landingAccountBtn.title = 'Signed in – click to sign out';
  } else {
    landingAccountBtn.textContent = 'Sign In with BoxBap.com';
    landingAccountBtn.title = 'Sign in to keep your pieces across devices';
  }
}

function openWriterId(): void {
  writerIdEl.hidden = false;
  document.getElementById('wid-continue')!.focus();
}

function closeWriterId(): void {
  writerIdEl.hidden = true;
}

function startBoxBapAuth(): void {
  closeWriterId();
  if (!authDialog.open) setAuthMode('signin');
  authError.textContent = '';
  if (!authDialog.open) authDialog.showModal();
}

// Replays the action (props, sync) that asked for sign-in once it succeeds.
let pendingAuthAction: (() => void) | null = null;
function requireAuth(action: () => void, prompt: boolean): void {
  pendingAuthAction = action;
  if (prompt) openWriterId();
  else startBoxBapAuth();
}
function runPendingAuth(): void {
  const action = pendingAuthAction;
  pendingAuthAction = null;
  if (action && signedIn()) action();
}

function syncNow(): void {
  // saveNow pushes to the cloud whenever a user is signed in.
  if (!swapPending) saveNow();
}

document.getElementById('wid-continue')!.addEventListener('click', startBoxBapAuth);
document.getElementById('wid-dismiss')!.addEventListener('click', () => {
  pendingAuthAction = null;
  closeWriterId();
});
writerIdEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    pendingAuthAction = null;
    closeWriterId();
  }
});
landingAccountBtn.addEventListener('click', () => {
  // Signing an anonymous user out would burn their uid and orphan every piece they painted.
  if (!signedIn()) return startBoxBapAuth();
  void signOutUser().catch((err) => console.error('Sign out failed', err));
});
document.getElementById('sync-btn')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  if (!signedIn()) return requireAuth(syncNow, false);
  syncNow();
});
renderAccount();

const reelCarAt = (e: PointerEvent): number => {
  const bounds = showcaseCanvas.getBoundingClientRect();
  return rollCarAt(e.clientX - bounds.left, e.clientY - bounds.top);
};
// Only one car is ever inspected at a time, so pinning one reel sets the other rolling again.
function releaseReel(id: ReelId): void {
  if (reelSel[id].pinned === null) return;
  reelSel[id].pinned = null;
  if (id === 'top') {
    if (roll?.showcase && roll.paused) {
      roll.paused = false;
      updateRollControls();
    }
  } else if (subwayReel.paused) {
    subwayReel.paused = false;
    renderSubControls();
  }
}

// Clicking a car only ever affects the reel it belongs to; the other reel keeps rolling.
function inspectRollingCar(i: number, source: ReelId): void {
  if (i < 0) {
    reelSel[source].pinned = null;
    if (cardSrc === source) showCard(-1, source);
    return;
  }
  if (source === 'top') {
    if (!roll?.showcase) return;
    // Clicking the already-selected car releases it and the train rolls on.
    if (reelSel.top.pinned === i && roll.paused) return toggleRollPause();
    const L = activeRollLayout(true);
    releaseReel('sub');
    roll.paused = true;
    roll.x = i * CAR_WIDTH + CAR_WIDTH / 2 - L.W / (2 * L.scale);
    reelSel.top.pinned = i;
    updateRollControls();
    showCard(i, 'top');
  } else {
    if (!subwayReel.entries.length) return;
    if (reelSel.sub.pinned === i && subwayReel.paused) {
      subwayReel.paused = false;
      reelSel.sub.pinned = null;
      if (cardSrc === 'sub') showCard(-1, 'sub');
      renderSubControls();
      return;
    }
    releaseReel('top');
    subwayReel.paused = true;
    subwayReel.sx = subwayCanvas.clientWidth / 2 - (i * CAR_WIDTH + CAR_WIDTH / 2) * subGeom.scale;
    reelSel.sub.pinned = i;
    renderSubControls();
    showCard(i, 'sub');
  }
}

function handleReelTap(e: PointerEvent): void {
  inspectRollingCar(reelCarAt(e), 'top');
}
showcaseCanvas.addEventListener('pointerup', handleReelTap);

// ---------- Bench View ----------
const BENCH_BG_KEY = 'graffbap_bench_bg';
const benchEl = document.getElementById('bench')!;
const benchView = document.getElementById('bench-view')!;
const benchCanvas = document.getElementById('bench-canvas') as HTMLCanvasElement;
const benchBgBox = document.getElementById('bench-bg') as HTMLInputElement;
const benchPropsBtn = document.getElementById('bench-props') as HTMLButtonElement;
const benchPropsCount = document.getElementById('bench-props-count')!;
const benchBadge = document.getElementById('bench-badge')!;
const benchToyBtn = document.getElementById('bench-toy') as HTMLButtonElement;
const benchExportBtn = document.getElementById('bench-export') as HTMLButtonElement;
benchBgBox.checked = localStorage.getItem(BENCH_BG_KEY) !== '0';
let benchEntry: RollEntry | null = null;
let benchCar: HTMLCanvasElement | null = null;
let benchToken = 0;
const benchCam = { s: 1, tx: 0, ty: 0, fit: 1 };

async function benchPaint(e: RollEntry): Promise<HTMLCanvasElement | ImageBitmap | null> {
  if (e.reg) return createImageBitmap(await decodeDataUrl(e.reg.image));
  if (e.yard === 'preset') return presetPiece(e.index);
  await fetchLocal(e.yard, e.index);
  const c = yardConsists[e.yard][e.index]!;
  if (c === car()) return c.hasPaint ? copyBody() : null;
  if (!c.paint) return null;
  if (c.paint.canvas) return c.paint.canvas;
  const blob = await c.paint.blob;
  return blob ? createImageBitmap(blob) : null;
}

// Division light over the shared backdrop: sodium floodlights for freight, dusk haze for subway.
function drawYardLight(ctx: CanvasRenderingContext2D, yard: RollEntry['yard'], W: number, H: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (yard !== 'preset' && YARDS[yard].division === 'freight') {
    ctx.globalCompositeOperation = 'lighter';
    for (const fx of [0.15, 0.5, 0.85]) {
      const g = ctx.createRadialGradient(W * fx, 0, 0, W * fx, 0, H * 1.1);
      g.addColorStop(0, 'rgba(255, 170, 60, 0.35)');
      g.addColorStop(1, 'rgba(255, 170, 60, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.fillStyle = 'rgba(120, 60, 120, 0.12)';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawBench(): void {
  const ctx = benchCanvas.getContext('2d')!;
  const W = benchCanvas.width;
  const H = benchCanvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (benchBgBox.checked && benchEntry) {
    drawBackdrop(ctx, { x: 0, y: -EXPORT_CROP.y, scale: 1 }, 1, W, H);
    drawYardLight(ctx, benchEntry.yard, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (benchCar) ctx.drawImage(benchCar, 0, 0);
}

function applyBenchCam(): void {
  const vw = benchView.clientWidth;
  const vh = benchView.clientHeight;
  const w = CAR_WIDTH * benchCam.s;
  const h = EXPORT_CROP.h * benchCam.s;
  benchCam.tx = w <= vw ? (vw - w) / 2 : Math.min(0, Math.max(vw - w, benchCam.tx));
  benchCam.ty = h <= vh ? (vh - h) / 2 : Math.min(0, Math.max(vh - h, benchCam.ty));
  benchCanvas.style.transform = `translate(${benchCam.tx}px, ${benchCam.ty}px) scale(${benchCam.s})`;
}

function fitBench(): void {
  benchCam.fit = Math.min(benchView.clientWidth / CAR_WIDTH, benchView.clientHeight / EXPORT_CROP.h);
  benchCam.s = benchCam.fit;
  applyBenchCam();
}

function zoomBenchAt(scale: number, px: number, py: number): void {
  const ns = Math.min(3, Math.max(benchCam.fit, scale));
  benchCam.tx = px - ((px - benchCam.tx) * ns) / benchCam.s;
  benchCam.ty = py - ((py - benchCam.ty) * ns) / benchCam.s;
  benchCam.s = ns;
  applyBenchCam();
}

function openBench(i: number, src: 'top' | 'sub' = 'top'): void {
  const e = src === 'sub' ? (subwayReel.entries[i] ?? null) : entryAt(i);
  if (e) openBenchEntry(e);
}

function openBenchEntry(e: RollEntry): void {
  benchEntry = { ...e };
  benchCar = null;
  const token = ++benchToken;
  const v = CAR_VARIANTS[e.index]!;
  document.getElementById('bench-title')!.textContent = `Car ${String(e.index + 1).padStart(2, '0')} · ${v.mark} ${v.number}`;
  document.getElementById('bench-writer')!.textContent = entryWriter(e) ?? 'Bare steel – waiting for a writer';
  document.getElementById('bench-origin')!.textContent = entryOrigin(e);
  benchPropsCount.textContent = String(entryProps(e, readMeta()));
  renderRating(e, benchRatingUI());
  benchEl.className = `bench-${e.yard}`;
  if (benchCanvas.width !== CAR_WIDTH || benchCanvas.height !== EXPORT_CROP.h) {
    benchCanvas.width = CAR_WIDTH;
    benchCanvas.height = EXPORT_CROP.h;
    benchCanvas.style.width = `${CAR_WIDTH}px`;
    benchCanvas.style.height = `${EXPORT_CROP.h}px`;
  }
  benchEl.hidden = false;
  benchExportBtn.disabled = true;
  fitBench();
  drawBench();
  void benchPaint(e)
    .then((paint) => {
      if (token !== benchToken) return;
      const full = !!paint && paint.width === CAR_WIDTH;
      benchCar = renderCarImage(entryBaseId(e), paint, full, 1);
      drawBench();
      benchExportBtn.disabled = false;
    })
    .catch((err) => console.error('Bench View load failed', err));
}

function closeBench(): void {
  benchToken++;
  benchEl.hidden = true;
  benchEntry = null;
  benchCar = null;
}

document.getElementById('bench-close')!.addEventListener('click', closeBench);
document.getElementById('cc-bench')!.addEventListener('click', () => {
  const i = cardCar;
  const src = cardSrc;
  showCard(-1);
  openBench(i, src);
});
benchBgBox.addEventListener('change', () => {
  localStorage.setItem(BENCH_BG_KEY, benchBgBox.checked ? '1' : '0');
  drawBench();
});
const benchRatingUI = (): RatingUI => ({
  props: benchPropsCount,
  toys: document.getElementById('bench-toy-count')!,
  approval: document.getElementById('bench-approval')!,
  propsBtn: benchPropsBtn,
  toyBtn: benchToyBtn,
});
benchPropsBtn.addEventListener('click', () => {
  const e = benchEntry;
  if (!e) return;
  castVote(e, 'props', () => {
    renderRating(e, benchRatingUI());
    popEls(benchPropsBtn, benchBadge);
  });
});
benchToyBtn.addEventListener('click', () => {
  const e = benchEntry;
  if (!e) return;
  castVote(e, 'toy', () => {
    renderRating(e, benchRatingUI());
    popEls(benchToyBtn);
  });
});
benchExportBtn.addEventListener('click', () => {
  const e = benchEntry;
  if (!e || !benchCar) return;
  // Exactly what the bench shows plus the BoxBap.com logo – no writer, date, or yard stamp.
  const out = benchBgBox.checked ? benchCanvas : benchCar;
  const tag = e.yard === 'preset' ? 'community' : e.yard;
  void runExport(async () =>
    downloadCanvas(
      await stampLogo(out),
      `graffbap-bench-${tag}-car-${String(e.index + 1).padStart(2, '0')}-${fileTimestamp()}.png`,
    ),
  );
});

benchView.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const r = benchView.getBoundingClientRect();
    zoomBenchAt(benchCam.s * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);
const benchPts = new Map<number, { x: number; y: number }>();
benchView.addEventListener('pointerdown', (e) => {
  benchView.setPointerCapture(e.pointerId);
  benchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
benchView.addEventListener('pointermove', (e) => {
  const prev = benchPts.get(e.pointerId);
  if (!prev) return;
  const r = benchView.getBoundingClientRect();
  if (benchPts.size === 1) {
    benchCam.tx += e.clientX - prev.x;
    benchCam.ty += e.clientY - prev.y;
    benchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    applyBenchCam();
    return;
  }
  const [a, b] = [...benchPts.values()] as [{ x: number; y: number }, { x: number; y: number }];
  const d0 = Math.hypot(a.x - b.x, a.y - b.y);
  const m0 = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  benchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const [c, d] = [...benchPts.values()] as [{ x: number; y: number }, { x: number; y: number }];
  const d1 = Math.hypot(c.x - d.x, c.y - d.y);
  const m1 = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };
  benchCam.tx += m1.x - m0.x;
  benchCam.ty += m1.y - m0.y;
  if (d0 > 0) zoomBenchAt(benchCam.s * (d1 / d0), m1.x - r.left, m1.y - r.top);
  else applyBenchCam();
});
for (const type of ['pointerup', 'pointercancel'] as const) {
  benchView.addEventListener(type, (e) => benchPts.delete(e.pointerId));
}
window.addEventListener('resize', () => {
  if (!benchEl.hidden) fitBench();
});
// Practice is scrap paper: drop every car so a session never inherits or leaves paint.
function wipePracticeYards(): void {
  clearTimeout(saveTimer);
  savePending = false;
  resetPieceSession();
  for (const id of Object.keys(yardConsists) as YardId[]) {
    for (const c of yardConsists[id]) {
      c.paint = null;
      c.undo.length = 0;
      c.redo.length = 0;
      c.hasPaint = false;
      c.sketch = null;
      c.version++;
      c.remoteState = 'none';
      c.localState = 'none';
    }
  }
  swapPending = false;
  ++swapToken;
  paintCtx.globalAlpha = 1;
  paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  sketchCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  sketchHas = false;
  dirty = true;
  updateConsistUI();
  updateHistoryButtons();
}

const practiceNote = document.getElementById('practice-note')!;

// #gallery (default landing) shows the reel; #yard is the paint app.
function applyRoute(): void {
  const gallery = location.hash !== '#yard';
  if (gallery) {
    flushActiveCar();
    if (practiceMode) {
      practiceMode = false;
      wipePracticeYards();
    }
    sessionStorage.removeItem(SESSION_KEY);
    if (roll && !roll.showcase) exitRollBy(-1);
    if (!roll) void startMainline();
    startSubwayLine();
  } else {
    // Tear the landing reel down so the editor underneath is revealed.
    if (roll?.showcase) exitRollBy(-1);
    const saved = recallSession();
    const y = pendingYard ?? saved?.yard ?? null;
    practiceMode = pendingYard ? pendingPractice : saved?.practice === true;
    pendingYard = null;
    pendingPractice = false;
    if (y && y !== currentYard) switchYard(y);
    rememberSession(currentYard, practiceMode);
    setYardOptions(practiceMode);
    if (practiceMode) wipePracticeYards();
    resetYardSession();
    if (pendingPiece) {
      const { reg, edit } = pendingPiece;
      pendingPiece = null;
      pendingFresh = false;
      void loadPieceIntoEditor(reg, edit);
    } else if (pendingFresh) {
      pendingFresh = false;
      startFreshCar();
    }
  }
  practiceNote.hidden = gallery || !practiceMode;
}

// Blank steel on a randomly picked body, writing to a brand-new piece.
function startFreshCar(): void {
  if (mode !== 'none' || busy) return;
  finishDrips();
  glazes.length = 0;
  clearTimeout(saveTimer);
  savePending = false;
  resetPieceSession();
  rememberPiece(null);
  currentCarIndex = Math.floor(Math.random() * CAR_COUNT);
  const c = car();
  c.paint = null;
  c.undo.length = 0;
  c.redo.length = 0;
  c.hasPaint = false;
  c.sketch = null;
  c.version++;
  c.localState = 'done';
  c.remoteState = 'done';
  swapPending = false;
  ++swapToken;
  applyCarBase(baseIdFor(currentYard, currentCarIndex));
  paintCtx.globalAlpha = 1;
  paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  sketchCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
  sketchHas = false;
  saveStatus.textContent = '';
  dirty = true;
  updateConsistUI();
  updateHistoryButtons();
}

// Drops an existing piece onto the canvas: editing keeps writing to its doc, a cover starts a new one.
async function loadPieceIntoEditor(reg: RegistryCar, edit: boolean): Promise<void> {
  try {
    const img = new Image();
    img.src = reg.image;
    await img.decode();
    currentCarIndex = Math.min(Math.max(0, reg.slot), CAR_COUNT - 1);
    applyCarBase(baseIdFor(currentYard, currentCarIndex));
    const c = car();
    c.version++;
    c.undo.length = 0;
    c.redo.length = 0;
    c.localState = 'done';
    c.remoteState = 'done';
    paintCtx.globalAlpha = 1;
    paintCtx.clearRect(0, 0, CAR_WIDTH, CAR_HEIGHT);
    if (img.width === BODY.w) paintCtx.drawImage(img, BODY.x, BODY.y);
    else paintCtx.drawImage(img, 0, 0);
    c.hasPaint = true;
    c.paint = snapshot(paintLayer, true);
    currentPieceId = edit ? reg.id : null;
    rememberPiece(currentPieceId);
    pieceBasedOn = edit ? null : { id: reg.id, writer: reg.writer || 'Anonymous' };
    dirty = true;
    updateConsistUI();
    updateHistoryButtons();
    showToast(edit ? 'Picking up where you left off' : `Painting over ${reg.writer || 'Anonymous'}'s piece`);
  } catch (err) {
    console.error('Could not open that piece', err);
    showToast('Could not open that piece');
  }
}
window.addEventListener('hashchange', applyRoute);

// ---------- Subway Line: westbound (right-to-left) tunnel reel on Dispatch ----------
const subwayCanvas = document.getElementById('subway-canvas') as HTMLCanvasElement;
const subwayCtx = subwayCanvas.getContext('2d', { alpha: false })!;
const subwayTitle = document.getElementById('subway-title')!;
const SUBWAY_LINE_SIZE = 12;
const subwayReel = {
  sx: Number.NaN,
  lastT: 0,
  entries: [] as RollEntry[],
  images: [] as (CanvasImageSource | null)[],
  token: 0,
  started: false,
  paused: false,
  speedIdx: 1,
  // null = the Subway Line; otherwise that yard's consist.
  yard: null as YardId | null,
};
const subPlayBtn = document.getElementById('sub-play') as HTMLButtonElement;
const subSpeedBtn = document.getElementById('sub-speed') as HTMLButtonElement;
const subBackBtn = document.getElementById('sub-back') as HTMLButtonElement;
let subGeom = { W: 1, scale: 1, trainW: 1 };

// Public subway archives, with community presets standing in until real cars land.
async function buildSubwayLine(): Promise<{ entries: RollEntry[]; images: (CanvasImageSource | null)[] }> {
  try {
    const live = (await listFeed('subway', subSort, SUBWAY_LINE_SIZE)).map(regEntry).filter((e): e is RollEntry => !!e);
    if (live.length) return { entries: live, images: await Promise.all(live.map(entryImage)) };
  } catch (err) {
    console.error('Registry feed failed', err);
  }
  const fallback = presetEntries().map((e) => ({ ...e, sub: true, props: entryProps(e, readMeta()) }));
  return { entries: fallback, images: await Promise.all(fallback.map(entryImage)) };
}

async function buildMySubwayLine(): Promise<{ entries: RollEntry[]; images: (CanvasImageSource | null)[] }> {
  const uid = currentUser?.uid;
  if (!uid) return { entries: [], images: [] };
  try {
    const mine = (await listMine(uid, 'subway', SUBWAY_LINE_SIZE)).map(regEntry).filter((e): e is RollEntry => !!e);
    return { entries: mine, images: await Promise.all(mine.map(entryImage)) };
  } catch (err) {
    console.error('My pieces feed failed', err);
    return { entries: [], images: [] };
  }
}

function startSubwayLine(): void {
  if (!subwayReel.started) loadSubwayLine(null);
}

function loadSubwayLine(yard: YardId | null): void {
  subwayReel.started = true;
  const token = ++subwayReel.token;
  subwayReel.yard = yard;
  subBackBtn.hidden = true;
  resetReelSel('sub');
  if (cardSrc === 'sub') showCard(-1, 'sub');
  subwayReel.entries = [];
  subwayReel.images = [];
  subwayReel.sx = Number.NaN;
  subwayTitle.textContent = myWork.sub ? 'My Subways' : 'Public Subway';
  void (myWork.sub ? buildMySubwayLine() : buildSubwayLine()).then(({ entries, images }) => {
    if (token !== subwayReel.token) return;
    subwayReel.entries = entries;
    subwayReel.images = images;
    subwayReel.sx = Number.NaN;
    resetReelSel('sub');
    subDescription.textContent = entries.length || !myWork.sub ? '' : "You haven't painted any subway cars yet.";
  });
}
function renderSubControls(): void {
  const label = subwayReel.paused ? 'Play' : 'Pause';
  subPlayBtn.innerHTML = subwayReel.paused ? '&#x25B6;' : '&#x23F8;';
  subPlayBtn.setAttribute('aria-label', label);
  subPlayBtn.title = label;
  const speed = `${ROLL_SPEEDS[subwayReel.speedIdx]!.rate}x`;
  subSpeedBtn.textContent = speed;
  subSpeedBtn.title = `Speed ${speed}`;
}

const subCarAt = (x: number): number => {
  const i = Math.floor((x - subwayReel.sx) / (CAR_WIDTH * subGeom.scale));
  return i >= 0 && i < subwayReel.entries.length ? i : -1;
};

subPlayBtn.addEventListener('click', () => {
  subPlayBtn.blur();
  subwayReel.paused = !subwayReel.paused;
  if (!subwayReel.paused) {
    reelSel.sub.pinned = null;
    if (cardSrc === 'sub') showCard(-1, 'sub');
  }
  renderSubControls();
});
subSpeedBtn.addEventListener('click', () => {
  subSpeedBtn.blur();
  subwayReel.speedIdx = (subwayReel.speedIdx + 1) % ROLL_SPEEDS.length;
  renderSubControls();
});
subBackBtn.addEventListener('click', () => loadSubwayLine(null));
subwayCanvas.addEventListener('pointerup', (e) => inspectRollingCar(subCarAt(e.offsetX), 'sub'));
subwayCanvas.addEventListener('pointerleave', (e) => {
  if (cardSrc !== 'sub' || reelSel.sub.pinned !== null) return;
  if (!(e.relatedTarget instanceof Node && carCard.contains(e.relatedTarget))) showCard(-1, 'sub');
});
renderSubControls();

function drawTunnel(ctx: CanvasRenderingContext2D, W: number, H: number, railY: number): void {
  const wall = ctx.createLinearGradient(0, 0, 0, H);
  wall.addColorStop(0, '#07080a');
  wall.addColorStop(0.55, '#15171a');
  wall.addColorStop(1, '#0a0b0c');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, W, H);
  // Grimy tile courses and steel columns along the tunnel wall.
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  for (let y = 10; y < railY; y += 18) ctx.fillRect(0, y, W, 1);
  for (let x = 40; x < W; x += 170) {
    ctx.fillStyle = '#1d1f22';
    ctx.fillRect(x, 0, 14, railY);
    ctx.fillStyle = 'rgba(120,70,40,0.25)';
    const g = ctx.createRadialGradient(x, 6, 0, x, 6, H * 0.6);
    g.addColorStop(0, 'rgba(255,205,140,0.22)');
    g.addColorStop(1, 'rgba(255,205,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - H * 0.6, 0, H * 1.2, H * 0.6);
    ctx.fillStyle = '#f5d9a8';
    ctx.fillRect(x - 8, 2, 16, 4);
  }
  // Track bed: ballast, ties, running rails and the covered third rail.
  ctx.fillStyle = '#121212';
  ctx.fillRect(0, railY - 2, W, H - railY + 2);
  ctx.fillStyle = '#2a211b';
  for (let x = 0; x < W; x += 22) ctx.fillRect(x, railY + 2, 12, 5);
  ctx.fillStyle = '#8a8d90';
  ctx.fillRect(0, railY, W, 2);
  ctx.fillStyle = '#6b5a2c';
  ctx.fillRect(0, railY + 7, W, 3);
}

function renderSubwayReel(now: number): void {
  const W = Math.max(1, subwayCanvas.clientWidth);
  const H = Math.max(1, subwayCanvas.clientHeight);
  const px = reelDpr();
  const pw = Math.round(W * px);
  const ph = Math.round(H * px);
  if (subwayCanvas.width !== pw) subwayCanvas.width = pw;
  if (subwayCanvas.height !== ph) subwayCanvas.height = ph;
  const scale = Math.min((H - 16) / (EXPORT_CROP.h + 10), (W * CAR_FIT) / CAR_WIDTH);
  const oy = (H - EXPORT_CROP.h * scale) / 2 - EXPORT_CROP.y * scale;
  const railY = oy + 1142 * scale;
  const trainW = subwayReel.entries.length * CAR_WIDTH * scale;
  const dt = subwayReel.lastT ? Math.min(0.1, (now - subwayReel.lastT) / 1000) : 0;
  subwayReel.lastT = now;
  if (Number.isNaN(subwayReel.sx)) subwayReel.sx = W;
  if (!subwayReel.paused) {
    subwayReel.sx -= ROLL_SPEED * ROLL_SPEEDS[subwayReel.speedIdx]!.rate * scale * dt;
  }
  if (subwayReel.sx + trainW < 0) subwayReel.sx = W;
  else if (subwayReel.sx > W) subwayReel.sx = -trainW;
  subGeom = { W, scale, trainW };

  const ctx = subwayCtx;
  ctx.setTransform(px, 0, 0, px, 0, 0);
  drawTunnel(ctx, W, H, railY);
  const s = px * scale;
  subwayReel.entries.forEach((e, i) => {
    const x = subwayReel.sx + i * CAR_WIDTH * scale;
    if (x > W || x + CAR_WIDTH * scale < 0) return;
    ctx.setTransform(s, 0, 0, s, px * x, px * oy);
    drawCarComposite(ctx, entryBaseId(e), subwayReel.images[i] ?? null, false);
    if (i > 0) drawKnuckle(ctx, 0);
  });
  ctx.setTransform(px, 0, 0, px, 0, 0);
  const shade = ctx.createLinearGradient(0, 0, W, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.55)');
  shade.addColorStop(0.12, 'rgba(0,0,0,0)');
  shade.addColorStop(0.88, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  trackSelection(ctx, 'sub', subwayReel.entries.length, (i) => subwayReel.sx + i * CAR_WIDTH * scale, scale, oy, W);
}

// ---------- Session: aerosol gauge + the "still working?" idle check ----------
const yardHud = document.getElementById('yard-hud')!;
const yhName = document.getElementById('yh-name')!;
const yhStatus = document.getElementById('yh-status')!;
const yhGauge = document.getElementById('yh-gauge')!;
const yhGaugeFill = document.getElementById('yh-gauge-fill')!;
const GAUGE_REFILL_S = 60;
const IDLE_WARN_MS = 9.5 * 60_000;
const IDLE_EXIT_MS = 10 * 60_000;
let gauge = 1;
let gaugeDryNoticed = false;
let lastActivity = Date.now();
let lastTick = performance.now();

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function resetYardSession(): void {
  gauge = 1;
  gaugeDryNoticed = false;
  markActive();
}

function markActive(): void {
  lastActivity = Date.now();
  idleModal.hidden = true;
}

// Spray output multiplier: a dry can only sputters until the gauge recovers.
function sprayFlow(): number {
  return gauge > 0.02 ? 1 : Math.random() < 0.15 ? 0.4 : 0;
}

function yardStrokeStart(): void {
  markActive();
}

function yardTick(dt: number): void {
  const inYard = location.hash === '#yard';
  if (mode === 'paint' && brush.tool === 'spray') gauge = Math.max(0, gauge - dt / RULES.gauge);
  else gauge = Math.min(1, gauge + dt / GAUGE_REFILL_S);
  if (gauge <= 0.02 && !gaugeDryNoticed) {
    gaugeDryNoticed = true;
    showNotice("Can's dry – let it breathe");
  } else if (gauge > 0.2) gaugeDryNoticed = false;

  // Practice holds nothing, so it never gets timed out.
  if (inYard && !roll && !practiceMode) {
    const idle = Date.now() - lastActivity;
    if (idle >= IDLE_EXIT_MS) {
      markActive();
      flushActiveCar();
      location.hash = '#gallery';
      showToast('Session closed – your piece is on the line');
    } else if (idle >= IDLE_WARN_MS) {
      idleModal.hidden = false;
      idleCountdown.textContent = clock(IDLE_EXIT_MS - idle);
    }
  }

  yardHud.hidden = !inYard || !!roll;
  if (yardHud.hidden) return;
  yhName.textContent = YARDS[currentYard].label;
  yhStatus.textContent = practiceMode ? 'Practice' : currentPieceId ? 'On the line' : 'Spray to start';
  yhGauge.hidden = false;
  yhGaugeFill.style.width = `${Math.round(gauge * 100)}%`;
  yhGauge.classList.toggle('low', gauge < 0.2);
}

const idleModal = document.getElementById('still-working')!;
const idleCountdown = document.getElementById('sw-countdown')!;
document.getElementById('still-continue')!.addEventListener('click', markActive);
for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
  document.addEventListener(type, () => {
    if (!idleModal.hidden) return;
    lastActivity = Date.now();
  });
}

// ---------- Stash Book export ----------
// Car-space rows that contain the car (roof lip to rail); everything else is empty sky.
const EXPORT_CROP = { y: 130, h: 1020 };
const TRAIN_CAR_H = 360;
let exporting = false;

const toast = document.getElementById('toast')!;
let toastTimer = 0;

function showToast(text: string, holdMs = 2500): void {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  if (holdMs > 0) toastTimer = window.setTimeout(() => (toast.hidden = true), holdMs);
}

// Draws one finished car at the ctx's car-space transform. `clip` trims weathering to the
// car silhouette, which only works on an isolated (transparent) canvas.
function drawCarComposite(
  ctx: CanvasRenderingContext2D,
  index: number,
  paint: CanvasImageSource | null,
  fullSize: boolean,
  clip = false,
): void {
  const base = carBase(index);
  ctx.drawImage(base.bg, 0, 0, CAR_WIDTH, CAR_HEIGHT);
  if (paint) {
    if (fullSize) ctx.drawImage(paint, 0, 0);
    else ctx.drawImage(paint, BODY.x, BODY.y, BODY.w, BODY.h);
  }
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(grimeLayer, WEATHER.x, WEATHER.y);
  ctx.globalCompositeOperation = 'soft-light';
  ctx.drawImage(sheenLayer, WEATHER.x, WEATHER.y);
  if (clip) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base.bg, 0, 0, CAR_WIDTH, CAR_HEIGHT);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(base.fg, 0, 0, CAR_WIDTH, CAR_HEIGHT);
}

function renderCarImage(
  index: number,
  paint: CanvasImageSource | null,
  fullSize: boolean,
  scale: number,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(CAR_WIDTH * scale);
  c.height = Math.round(EXPORT_CROP.h * scale);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, -EXPORT_CROP.y * scale);
  drawCarComposite(ctx, index, paint, fullSize, true);
  return c;
}

const fileTimestamp = () => new Date().toISOString().replace(/[:.]/g, '-');

function downloadCanvas(c: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      if (!b) return reject(new Error('PNG encode failed'));
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve();
    }, 'image/png'),
  );
}

async function runExport(task: () => Promise<void>): Promise<void> {
  if (exporting) return;
  exporting = true;
  showToast('Rendering export…', 0);
  // Let the toast paint before the heavy synchronous compositing.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r)));
  try {
    await task();
    showToast('Export saved!');
  } catch (err) {
    console.error('Export failed', err);
    showToast('Export failed');
  } finally {
    exporting = false;
  }
}

function exportCar(): void {
  if (mode !== 'none' || locked()) return;
  finishDrips();
  const index = currentCarIndex;
  void runExport(async () =>
    downloadCanvas(
      await stampLogo(renderCarImage(baseIdFor(currentYard, index), paintLayer, true, 1)),
      `graffbap-car-${String(index + 1).padStart(2, '0')}-${fileTimestamp()}.png`,
    ),
  );
}

let logoImg: Promise<HTMLImageElement | null> | null = null;

// Copies the image and places the BoxBap.com logo in the lower-right corner.
async function stampLogo(src: HTMLCanvasElement): Promise<HTMLCanvasElement> {
  logoImg ??= (async () => {
    const img = new Image();
    img.src = boxbapLogoUrl;
    try {
      await img.decode();
      return img;
    } catch (err) {
      console.error('BoxBap logo failed to load', err);
      return null;
    }
  })();
  const logo = await logoImg;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(src, 0, 0);
  if (logo) {
    const h = Math.round(src.height * 0.1);
    const w = Math.round((logo.naturalWidth / logo.naturalHeight) * h);
    const pad = Math.round(h * 0.35);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, out.width - w - pad, out.height - h - pad, w, h);
    ctx.globalAlpha = 1;
  }
  return out;
}

function exportTrain(): void {
  const yardId = currentYard;
  void runExport(async () => {
    const scale = TRAIN_CAR_H / EXPORT_CROP.h;
    const paints = await Promise.all(
      consist.map(async (_, i) =>
        i === currentCarIndex ? paintLayer : (roll?.images[i] ?? (await loadCarBitmap(i))),
      ),
    );
    const carW = Math.round(CAR_WIDTH * scale);
    const strip = document.createElement('canvas');
    strip.width = carW * CAR_COUNT;
    strip.height = TRAIN_CAR_H;
    const ctx = strip.getContext('2d')!;
    paints.forEach((paint, i) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(renderCarImage(baseIdFor(currentYard, i), paint, i === currentCarIndex, scale), i * carW, 0);
      if (i > 0) {
        ctx.setTransform(scale, 0, 0, scale, i * carW, -EXPORT_CROP.y * scale);
        drawKnuckle(ctx, 0);
      }
    });
    await downloadCanvas(strip, `graffbap-train-consist-${yardId}-${fileTimestamp()}.png`);
    if (!roll) baseCache.clear();
  });
}

document.getElementById('export-car')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  exportCar();
});
document.getElementById('rollby-export')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  exportTrain();
});

authBtn.addEventListener('click', async () => {
  if (!signedIn()) {
    authDialog.showModal();
    return;
  }
  authBtn.disabled = true;
  try {
    await signOutUser();
  } catch (err) {
    console.error('Sign out failed', err);
  } finally {
    authBtn.disabled = false;
  }
});

const authDialog = document.getElementById('auth-dialog') as HTMLDialogElement;
const authForm = document.getElementById('auth-form') as HTMLFormElement;
const authFields = document.getElementById('auth-fields') as HTMLFieldSetElement;
const authEmail = document.getElementById('auth-email') as HTMLInputElement;
const authPassword = document.getElementById('auth-password') as HTMLInputElement;
const authName = document.getElementById('auth-name') as HTMLInputElement;
const authError = document.getElementById('auth-error')!;

const AUTH_ERRORS: Record<string, string> = {
  'auth/invalid-email': 'Invalid email address.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/invalid-login-credentials': 'Incorrect email or password.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/user-not-found': 'Incorrect email or password.',
  'auth/missing-password': 'Enter a password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/account-exists-with-different-credential': 'This email is already linked to a different sign-in method.',
  'auth/popup-blocked': 'Popup was blocked by the browser.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled.',
  'auth/too-many-requests': 'Too many attempts. Try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

async function runAuth(action: () => Promise<unknown>): Promise<void> {
  authError.textContent = '';
  authFields.disabled = true;
  try {
    await action();
    // Don't wait for the auth listener: the pending action needs the user now.
    currentUser = auth.currentUser;
    renderAccount();
    authDialog.close();
    runPendingAuth();
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    authError.textContent = AUTH_ERRORS[code] ?? 'Sign-in failed. Please try again.';
  } finally {
    authFields.disabled = false;
  }
}

document.getElementById('auth-google')!.addEventListener('click', () => runAuth(signInWithGoogle));
document.getElementById('auth-github')!.addEventListener('click', () => runAuth(signInWithGithub));
document.getElementById('auth-cancel')!.addEventListener('click', () => authDialog.close());

type AuthMode = 'signin' | 'register';
let authMode: AuthMode = 'signin';
const authSubmit = document.getElementById('auth-submit') as HTMLButtonElement;
const authSwitch = document.getElementById('auth-switch') as HTMLButtonElement;

function setAuthMode(next: AuthMode): void {
  authMode = next;
  const register = next === 'register';
  authForm.dataset.mode = next;
  authForm.querySelectorAll<HTMLElement>('[data-mode]').forEach((el) => (el.hidden = el.dataset.mode !== next));
  // Hidden + disabled keeps the alias out of native validation while signing in.
  authName.disabled = !register;
  authName.required = register;
  authPassword.autocomplete = register ? 'new-password' : 'current-password';
  document.getElementById('auth-title')!.textContent = register ? 'Create Profile' : 'Sign In';
  authSubmit.textContent = register ? '[ Create Profile ]' : '[ Sign In ]';
  authSwitch.textContent = register ? 'Already have a profile? Sign In' : 'Need a profile? Create one';
  authError.textContent = '';
}

authSwitch.addEventListener('click', () => {
  setAuthMode(authMode === 'signin' ? 'register' : 'signin');
  (authMode === 'register' ? authName : authEmail).focus();
});

authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const register = authMode === 'register';
  const email = authEmail.value.trim();
  const password = authPassword.value;
  const alias = authName.value.trim();
  if (register && !alias) {
    authError.textContent = 'Enter a Name / Alias to create a profile.';
    authName.focus();
    return;
  }
  runAuth(async () => {
    if (!register) return signInWithEmail(email, password);
    const cred = (await registerWithEmail(email, password)) as { user: User };
    await updateProfile(cred.user, { displayName: alias });
    renderAccount();
  });
});
setAuthMode('signin');

authDialog.addEventListener('close', () => {
  if (!signedIn()) pendingAuthAction = null;
  authPassword.value = '';
  authError.textContent = '';
});

void fetchLocal(currentYard, currentCarIndex);
// Everyone gets a uid on arrival so anonymous pieces still have an owner.
void ensureAnonymous().catch((err) => console.error('Anonymous sign-in failed', err));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  // Keep unsaved strokes instead of discarding them when the account changes.
  if (!swapPending) flushSave();
  saveStatus.textContent = '';
  const named = user && !user.isAnonymous;
  userName.textContent = named ? user.displayName || user.email?.split('@')[0] || 'Signed in' : '';
  authBtn.textContent = named ? 'Sign Out' : 'Sign In';
  renderAccount();
  // Signing out of a real profile must still leave a uid behind to paint with.
  if (!user) void ensureAnonymous().catch((err) => console.error('Anonymous sign-in failed', err));
});

// ---------- Render ----------
// Editor-only work light: dims the yard and lifts the area around the cursor.
function drawFlashlight(): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const R = 280;
  const cx = hover?.x ?? -1e5;
  const cy = hover?.y ?? -1e5;
  const shade = viewCtx.createRadialGradient(cx, cy, 0, cx, cy, R);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(0.5, 'rgba(0,0,0,0.15)');
  shade.addColorStop(1, 'rgba(2,4,10,0.78)');
  viewCtx.fillStyle = shade;
  viewCtx.fillRect(0, 0, W, H);
  if (!hover) return;
  const beam = viewCtx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.8);
  beam.addColorStop(0, 'rgba(255,236,200,0.45)');
  beam.addColorStop(1, 'rgba(255,236,200,0)');
  viewCtx.globalCompositeOperation = 'overlay';
  viewCtx.fillStyle = beam;
  viewCtx.fillRect(cx - R, cy - R, R * 2, R * 2);
  viewCtx.globalCompositeOperation = 'source-over';
}
function render(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  yardTick(dt);
  if (roll) {
    renderRollBy(now);
    if (roll.showcase) renderSubwayReel(now);
    requestAnimationFrame(render);
    return;
  }
  if (camAnim) {
    const t = Math.min(1, (now - camAnim.t0) / CAM_ANIM_MS);
    const k = 1 - (1 - t) ** 3;
    cam.x = camAnim.from.x + (camAnim.to.x - camAnim.from.x) * k;
    cam.y = camAnim.from.y + (camAnim.to.y - camAnim.from.y) * k;
    cam.scale = camAnim.from.scale + (camAnim.to.scale - camAnim.from.scale) * k;
    if (t >= 1) camAnim = null;
    dirty = true;
  }
  if (mode === 'paint' && brush.tool === 'spray' && !lineOrigin && now - lastDabAt >= SPRAY_HOLD_INTERVAL) {
    stampAt(lastCar.x, lastCar.y);
    dirty = true;
  }
  if (mode === 'paint' && brush.tool === 'mop' && !lineOrigin && now - lastDabAt >= MOP_HOLD_INTERVAL) {
    mopFlow += (1 - mopFlow) * 0.15;
    stampAt(lastCar.x, lastCar.y);
    dirty = true;
  }
  updateDrips(now);
  if (mode === 'paint' && brush.tool === 'paintball' && !lineOrigin) {
    if (now - lastShot >= PAINTBALL_INTERVAL) {
      stampAt(...screenToCar(lastScreen.x, lastScreen.y));
      lastShot = now;
      dirty = true;
    }
  }
  if (dirty) {
    dirty = false;
    drawBackdrop(viewCtx, cam, dpr, window.innerWidth, window.innerHeight);

    viewCtx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.x, dpr * cam.y);
    viewCtx.drawImage(bgLayer, 0, 0);
    viewCtx.drawImage(paintLayer, 0, 0);
    if (mode === 'paint' && usesStrokeLayer()) {
      viewCtx.globalAlpha = strokeAlpha();
      maskStrokeLayer();
      viewCtx.drawImage(strokeLayer, 0, 0);
      viewCtx.globalAlpha = 1;
    }
    if (glazes.length) {
      viewCtx.globalCompositeOperation = 'screen';
      for (let i = glazes.length - 1; i >= 0; i--) {
        const gz = glazes[i]!;
        const k = 1 - (now - gz.t0) / GLAZE_MS;
        if (k <= 0) {
          glazes.splice(i, 1);
          continue;
        }
        viewCtx.globalAlpha = 0.55 * k * k;
        viewCtx.drawImage(gz.c, gz.x, gz.y);
      }
      viewCtx.globalAlpha = 1;
      viewCtx.globalCompositeOperation = 'source-over';
      dirty = true;
    }
    viewCtx.globalCompositeOperation = 'multiply';
    viewCtx.drawImage(grimeLayer, WEATHER.x, WEATHER.y);
    viewCtx.globalCompositeOperation = 'soft-light';
    viewCtx.drawImage(sheenLayer, WEATHER.x, WEATHER.y);
    viewCtx.globalCompositeOperation = 'source-over';
    viewCtx.drawImage(fgLayer, 0, 0);
    if (sketchHas) viewCtx.drawImage(sketchLayer, 0, 0);
    if (stencil) {
      drawStencil(viewCtx);
      positionStencilHud();
    }

    viewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flashlight) drawFlashlight();
    viewCtx.strokeStyle = 'rgba(255,255,255,0.5)';
    viewCtx.lineWidth = 1;

    if (lineOrigin && hover) {
      viewCtx.setLineDash([6, 6]);
      viewCtx.beginPath();
      viewCtx.moveTo(cam.x + lineOrigin.x * cam.scale, cam.y + lineOrigin.y * cam.scale);
      viewCtx.lineTo(hover.x, hover.y);
      viewCtx.stroke();
      viewCtx.setLineDash([]);
    }

    if (hover && mode !== 'pan' && !spaceDown) {
      viewCtx.beginPath();
      if (sketchMode || brush.tool === 'spray' || brush.tool === 'mop' || brush.tool === 'buff') {
        const d = sketchMode
          ? sketchWidth()
          : brush.tool === 'spray'
            ? sprayDiameter()
            : brush.tool === 'mop'
              ? mopNib()
              : brush.size;
        viewCtx.arc(hover.x, hover.y, Math.max(1, (d / 2) * cam.scale), 0, TAU);
      } else if (brush.tool === 'chisel') {
        const h = Math.max(3, (chiselWidth() / 2) * cam.scale);
        const ax = Math.cos(CHISEL_ANGLE) * h;
        const ay = Math.sin(CHISEL_ANGLE) * h;
        viewCtx.moveTo(hover.x - ax, hover.y - ay);
        viewCtx.lineTo(hover.x + ax, hover.y + ay);
      } else if (brush.tool === 'roller') {
        const w = rollerWidth() * cam.scale;
        const t = Math.max(4, ROLLER_THICK * 2 * cam.scale);
        viewCtx.rect(hover.x - w / 2, hover.y - t / 2, w, t);
      } else {
        const r = Math.max(3, paintballRadius() * cam.scale);
        viewCtx.arc(hover.x, hover.y, r, 0, TAU);
        viewCtx.moveTo(hover.x - r * 1.6, hover.y);
        viewCtx.lineTo(hover.x + r * 1.6, hover.y);
        viewCtx.moveTo(hover.x, hover.y - r * 1.6);
        viewCtx.lineTo(hover.x, hover.y + r * 1.6);
      }
      viewCtx.stroke();
    }
  }
  requestAnimationFrame(render);
}

window.addEventListener('resize', resize);
resize();
fitCamera();
updateCursor();
requestAnimationFrame(render);
applyRoute();
document.body.classList.add('ready');

// Night switchyard drawn behind the car. Ground and skyline live in car space so they pan/zoom with it.
export const GROUND_Y = 1118;
const RAIL_Y = 1140;
const TIE_SPACING = 70;
const SKY_TILE_W = 1600;
const SKY_TILE_H = 1500;
// Skyline is distant and hazy, so a half-res tile is plenty.
const SKY_RES = 0.5;
const PARALLAX = 0.3;

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function buildSkyline(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(SKY_TILE_W * SKY_RES, SKY_TILE_H * SKY_RES);
  ctx.scale(SKY_RES, SKY_RES);
  const r = seededRandom(7);
  const H = SKY_TILE_H;

  const layers = [
    { color: '#121824', min: 420, max: 1050, lit: 0.015 },
    { color: '#0b0f16', min: 180, max: 620, lit: 0.03 },
  ];
  for (const layer of layers) {
    let x = 0;
    while (x < SKY_TILE_W) {
      const w = Math.min(60 + r() * 170, SKY_TILE_W - x);
      const h = layer.min + r() * (layer.max - layer.min);
      ctx.fillStyle = layer.color;
      ctx.fillRect(x, H - h, w, h);
      for (let wy = H - h + 14; wy < H - 20; wy += 22) {
        for (let wx = x + 8; wx < x + w - 10; wx += 16) {
          if (r() < layer.lit) {
            ctx.fillStyle = `rgba(255,${190 + Math.floor(r() * 50)},120,${0.25 + r() * 0.35})`;
            ctx.fillRect(wx, wy, 6, 9);
          }
        }
      }
      x += w + r() * 14;
    }
  }

  // Floodlight towers, kept away from tile edges so glows don't seam.
  for (const tx of [420, 1210]) {
    const top = H - 1320 - r() * 80;
    ctx.strokeStyle = '#0a0d12';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(tx, H);
    ctx.lineTo(tx, top);
    ctx.stroke();
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(tx - 60, top - 18, 120, 26);

    const cone = ctx.createLinearGradient(0, top, 0, H);
    cone.addColorStop(0, 'rgba(255,220,160,0.10)');
    cone.addColorStop(1, 'rgba(255,220,160,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(tx - 50, top);
    ctx.lineTo(tx + 50, top);
    ctx.lineTo(tx + 420, H);
    ctx.lineTo(tx - 420, H);
    ctx.closePath();
    ctx.fill();

    const glow = ctx.createRadialGradient(tx, top - 5, 0, tx, top - 5, 230);
    glow.addColorStop(0, 'rgba(255,236,200,0.55)');
    glow.addColorStop(0.15, 'rgba(255,210,150,0.25)');
    glow.addColorStop(1, 'rgba(255,200,140,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(tx - 230, top - 235, 460, 460);
    ctx.fillStyle = '#fff4dc';
    for (let i = -2; i <= 2; i++) ctx.fillRect(tx + i * 22 - 7, top - 14, 14, 10);
  }
  return c;
}

function buildBallast(): HTMLCanvasElement {
  const [c, ctx] = makeCanvas(256, 256);
  const r = seededRandom(11);
  ctx.fillStyle = '#17171a';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 30 + Math.floor(r() * 45);
    ctx.fillStyle = `rgb(${v},${v - 2},${v - 5})`;
    const s = 2 + r() * 6;
    ctx.beginPath();
    ctx.ellipse(r() * 256, r() * 256, s, s * (0.5 + r() * 0.5), r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

let skyline: HTMLCanvasElement | null = null;
let ballast: HTMLCanvasElement | null = null;

export function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  cam: { x: number; y: number; scale: number },
  dpr: number,
  viewW: number,
  viewH: number,
): void {
  skyline ??= buildSkyline();
  ballast ??= buildBallast();

  // Screen-space sky with sodium-light haze at the horizon.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const horizon = cam.y + GROUND_Y * cam.scale;
  const sky = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
  sky.addColorStop(0, '#03050a');
  sky.addColorStop(0.7, '#0c1220');
  sky.addColorStop(1, '#2a2a33');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, viewW, viewH);

  // Car-space layers.
  ctx.setTransform(dpr * cam.scale, 0, 0, dpr * cam.scale, dpr * cam.x, dpr * cam.y);
  const left = -cam.x / cam.scale;
  const right = (viewW - cam.x) / cam.scale;
  const bottom = Math.max(GROUND_Y + 1, (viewH - cam.y) / cam.scale);

  const skyPattern = ctx.createPattern(skyline, 'repeat-x')!;
  skyPattern.setTransform(
    new DOMMatrix().translate(left * PARALLAX, GROUND_Y - SKY_TILE_H).scale(1 / SKY_RES),
  );
  ctx.fillStyle = skyPattern;
  ctx.fillRect(left, GROUND_Y - SKY_TILE_H, right - left, SKY_TILE_H);

  const mist = ctx.createLinearGradient(0, GROUND_Y - 650, 0, GROUND_Y);
  mist.addColorStop(0, 'rgba(110,125,150,0)');
  mist.addColorStop(1, 'rgba(110,125,150,0.22)');
  ctx.fillStyle = mist;
  ctx.fillRect(left, GROUND_Y - 650, right - left, 650);

  ctx.fillStyle = ctx.createPattern(ballast, 'repeat')!;
  ctx.fillRect(left, GROUND_Y, right - left, bottom - GROUND_Y);
  const shade = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 400);
  shade.addColorStop(0, 'rgba(0,0,0,0.1)');
  shade.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = shade;
  ctx.fillRect(left, GROUND_Y, right - left, bottom - GROUND_Y);

  ctx.fillStyle = '#231a14';
  for (let x = Math.floor(left / TIE_SPACING) * TIE_SPACING; x < right; x += TIE_SPACING) {
    ctx.fillRect(x, RAIL_Y + 16, 44, 16);
  }
  ctx.fillStyle = '#34302b';
  ctx.fillRect(left, RAIL_Y, right - left, 18);
  ctx.fillStyle = '#77716a';
  ctx.fillRect(left, RAIL_Y, right - left, 4);
}

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

interface TestDrip {
  x: number; y: number; startY: number; endY: number; w0: number; color: string; alpha: number;
}
interface PaintingHarness {
  reset(size: number, cap: string, color?: string, opacity?: number): void;
  line(x0: number, y0: number, x1: number, y1: number, duration: number, steps: number): void;
  pixel(ctx: CanvasRenderingContext2D, x: number, y: number): number[];
  stampAt(x: number, y: number, elapsedMs: number): void;
  hold(x: number, y: number, ticks: number, interval: number): void;
  move(x: number, y: number, time: number, coalesced?: { clientX: number; clientY: number; timeStamp: number }[]): void;
  previewStrokeLayer(): HTMLCanvasElement;
  maskStrokeLayer(): void;
  strokeCtx: CanvasRenderingContext2D;
  paintCtx: CanvasRenderingContext2D;
  maskCtx: CanvasRenderingContext2D;
  strokeLayer: HTMLCanvasElement;
  drips: TestDrip[];
  drawDripSegment(drip: TestDrip, y: number): void;
  drawDripTip(drip: TestDrip): void;
  setStencil(value: object): void;
  setEdge(value: number): void;
  spawnRollerRuns(): void;
}
declare global {
  var painting: PaintingHarness;
}

const source = fs.readFileSync(path.resolve('src', 'main.ts'), 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
const names = new Set([
  'brush', 'stamp', 'sprayDiameter', 'sprayHardness', 'hexToRgb', 'rebuildStamp',
  'spacing', 'dabAlpha', 'dab', 'TAU', 'sprayAlpha', 'stampAt', 'strokeTo',
  'WET_CELL', 'WET_COLS', 'WET_ROWS', 'wetness', 'wetAt', 'DRIP_THRESHOLD',
  'MAX_DRIPS', 'lastDabAt', 'sprayMoveAt', 'sprayWetCarry', 'drips', 'spawnDrip', 'addWetness', 'spawnRollerRuns',
  'maskStrokeLayer', 'strokePreview', 'previewStrokeLayer', 'drawDripSegment', 'drawDripTip',
]);
const selected = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  ? names.has(node.name?.text ?? '')
  : ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.has(item.name.getText(ast))));
const code = ts.transpileModule(selected.map(node => node.getText(ast)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const movement = ast.statements.find(node => ts.isExpressionStatement(node) &&
  ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'viewport.addEventListener' &&
  node.expression.arguments[0]?.getText(ast) === "'pointermove'");
if (!movement) throw new Error('Painting pointer handler was not found.');
const movementCode = ts.transpileModule(movement.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => route.abort());
  await page.goto('about:blank');
  await page.addScriptTag({ content: `
    const CAR_WIDTH = 512, CAR_HEIGHT = 512, BODY = { x: 0, y: 0, w: 512, h: 512 };
    const layer = () => { const c = document.createElement('canvas'); c.width = c.height = 512; return c; };
    const strokeLayer = layer(), strokeCtx = strokeLayer.getContext('2d');
    const paintLayer = layer(), paintCtx = paintLayer.getContext('2d');
    const maskLayer = layer(), maskCtx = maskLayer.getContext('2d');
    let stencil = null, dirty = false, carry = 0, lastCar = { x: 0, y: 0 };
    let hover = null, mode = 'paint', activePointer = 1, straightLineGesture = false, lineOrigin = null;
    let lastScreen = { x: 0, y: 0 }, moveHandler;
    const touches = new Map(), screenToCar = (x, y) => [x, y], strokeSounds = () => {};
    const viewport = { addEventListener: (_, handler) => { moveHandler = handler; } };
    let clock = 0;
    Object.defineProperty(performance, 'now', { value: () => clock });
    let strokeBox = { minX: 0, minY: 0, maxX: 512, maxY: 512 };
    const ensureMask = () => !!stencil;
    const maskAllows = (x, y) => !stencil || maskCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data[3] > 127;
    const markTouch = () => true;
    const toolSpacing = () => spacing();
    ${code}
    ${movementCode}
    let randomSeed = 12345;
    Math.random = () => { randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0; return randomSeed / 4294967296; };
    const reset = (size, cap, color = '#ffffff', opacity = 0.8) => {
      Object.assign(brush, { size, cap, color, opacity, hardness: 0.2, tool: 'spray' });
      strokeCtx.globalAlpha = 1; strokeCtx.clearRect(0, 0, 512, 512);
      paintCtx.globalAlpha = 1; paintCtx.clearRect(0, 0, 512, 512);
      maskCtx.clearRect(0, 0, 512, 512); stencil = null;
      wetness.fill(0); wetAt.fill(0); drips.length = 0; carry = 0;
      clock = 0; sprayMoveAt = 0; sprayWetCarry = 0;
      rebuildStamp(); sprayAlpha = dabAlpha();
    };
    const line = (x0, y0, x1, y1, duration, steps) => {
      lastCar = { x: x0, y: y0 }; carry = 0; stampAt(x0, y0);
      for (let i = 1; i <= steps; i++) {
        clock += duration / steps;
        strokeTo(x0 + (x1-x0)*i/steps, y0 + (y1-y0)*i/steps, duration/steps);
      }
    };
    const hold = (x, y, ticks, interval) => {
      for (let i = 0; i < ticks; i++) { clock += interval; stampAt(x, y, interval); }
    };
    const move = (clientX, clientY, timeStamp, coalesced = []) => {
      clock = timeStamp;
      moveHandler({ clientX, clientY, timeStamp, pointerId: 1, pointerType: 'mouse', shiftKey: false,
        getCoalescedEvents: () => coalesced });
    };
    const pixel = (ctx, x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data);
    globalThis.painting = { reset, line, hold, move, pixel, stampAt, previewStrokeLayer, maskStrokeLayer, spawnRollerRuns,
      strokeCtx, paintCtx, maskCtx, strokeLayer, brush, drips, drawDripSegment, drawDripTip,
      setEdge: value => { brush.hardness = value; rebuildStamp(); sprayAlpha = dabAlpha(); },
      setStencil: value => { stencil = value; } };
  ` });
});

for (const cap of ['fat', 'skinny']) {
  test(`${cap}: moving outlines stay drip-free regardless of event subdivision or line direction`, async ({ page }) => {
    const results = await page.evaluate(cap => {
      const p = globalThis.painting;
      const results = [];
      for (const size of [2, 8, 40, 150]) {
        for (const steps of [1, 10, 100]) {
          for (const [x0, y0, x1, y1] of [[256, 100, 256, 400], [100, 256, 400, 256], [256, 200, 256, 212]]) {
            p.reset(size, cap);
            p.line(x0, y0, x1, y1, 180, steps);
            results.push({ size, steps, drips: p.drips.length });
          }
        }
      }
      return results;
    }, cap);
    for (const result of results) expect(result.drips, JSON.stringify(result)).toBe(0);
  });

  test(`${cap}: holding still builds paint and makes drips originate inside the painted core`, async ({ page }) => {
    const results = await page.evaluate(cap => {
      const p = globalThis.painting;
      const results = [];
      for (const size of [2, 8, 40, 150]) {
        p.reset(size, cap);
        p.hold(256, 180, 80, 30);
        const drips = p.drips.map(d => ({ x: d.x, startY: d.startY, width: d.w0,
          originAlpha: p.pixel(p.strokeCtx, Math.floor(d.x), Math.floor(d.startY))[3] }));
        results.push({ size, drips, centerAlpha: p.pixel(p.strokeCtx, 256, 180)[3] });
      }
      return results;
    }, cap);
    for (const result of results) {
      expect(result.drips.length).toBeGreaterThan(0);
      expect(result.drips.length).toBeLessThan(10);
      expect(result.centerAlpha).toBeGreaterThan(245);
      for (const drip of result.drips) {
        expect(drip.originAlpha).toBeGreaterThan(150);
        expect(Math.abs(drip.x - 256)).toBeLessThanOrEqual(result.size * 0.12);
        expect(drip.width).toBeLessThanOrEqual(result.size * 0.15);
      }
    }
  });

  test(`${cap}: a moving pass covers previous paint in both color directions`, async ({ page }) => {
    const results = await page.evaluate(cap => {
      const p = globalThis.painting;
      const results = [];
      for (const [under, over] of [['#000000', '#ffffff'], ['#ffffff', '#000000']]) {
        p.reset(40, cap, over);
        p.paintCtx.fillStyle = under; p.paintCtx.fillRect(0, 0, 512, 512);
        p.line(100, 256, 400, 256, 300, 30);
        p.paintCtx.drawImage(p.strokeLayer, 0, 0);
        results.push({ under, rgb: p.pixel(p.paintCtx, 256, 256)[0] });
      }
      return results;
    }, cap);
    expect(results[0].rgb).toBeGreaterThanOrEqual(190);
    expect(results[1].rgb).toBeLessThanOrEqual(65);
  });
}

test('stencil previews never erase pending paint or depend on the spray alpha; commit masks only once', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = globalThis.painting;
    p.reset(40, 'fat');
    p.line(100, 256, 400, 256, 200, 20);
    p.maskCtx.fillStyle = '#ffffff'; p.maskCtx.fillRect(0, 0, 240, 512);
    p.maskCtx.fillStyle = 'rgba(255,255,255,0.5)'; p.maskCtx.fillRect(240, 0, 16, 512);
    p.setStencil({});
    p.strokeCtx.globalAlpha = 0.03;
    const before = p.pixel(p.strokeCtx, 200, 256);
    const edge = p.pixel(p.previewStrokeLayer().getContext('2d')!, 255, 256);
    for (let i = 0; i < 120; i++) p.previewStrokeLayer();
    const after = p.pixel(p.strokeCtx, 200, 256);
    const preview = p.previewStrokeLayer().getContext('2d')!;
    const previewInside = p.pixel(preview, 200, 256);
    const previewOutside = p.pixel(preview, 300, 256);
    p.maskStrokeLayer();
    return { before, after, edge, edgeAfter: p.pixel(preview, 255, 256), previewInside, previewOutside,
      committedInside: p.pixel(p.strokeCtx, 200, 256), committedOutside: p.pixel(p.strokeCtx, 300, 256),
      restoredAlpha: p.strokeCtx.globalAlpha };
  });
  expect(result.after).toEqual(result.before);
  expect(result.edgeAfter).toEqual(result.edge);
  expect(result.previewInside).toEqual(result.before);
  expect(result.committedInside).toEqual(result.before);
  expect(result.previewOutside[3]).toBe(0);
  expect(result.committedOutside[3]).toBe(0);
  expect(result.restoredAlpha).toBeCloseTo(0.03);
});

test('drip rendering preserves paint context opacity and color for other tools', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = globalThis.painting;
    p.reset(40, 'fat');
    p.paintCtx.globalAlpha = 0.4; p.paintCtx.fillStyle = '#ff0000';
    const d = { x: 200, y: 200, startY: 200, endY: 260, w0: 3, color: '#0000ff', alpha: 0.9 };
    p.drawDripSegment(d, 210); p.drawDripTip(d);
    return { alpha: p.paintCtx.globalAlpha, color: p.paintCtx.fillStyle };
  });

  expect(result.alpha).toBeCloseTo(0.4);
  expect(result.color).toBe('#ff0000');
});

test('the real pointer handler paints when coalesced events are empty and when they contain samples', async ({ page }) => {
  const results = await page.evaluate(() => {
    const p = globalThis.painting;
    const results = [];
    for (const coalesced of [[], [
      { clientX: 250, clientY: 256, timeStamp: 50 },
      { clientX: 400, clientY: 256, timeStamp: 100 },
    ]]) {
      p.reset(40, 'skinny');
      p.line(100, 256, 100, 256, 0, 1);
      p.move(400, 256, 100, coalesced);
      results.push({ alpha: p.pixel(p.strokeCtx, 256, 256)[3], drips: p.drips.length });
    }
    return results;
  });
  for (const result of results) {
    expect(result.alpha).toBeGreaterThanOrEqual(190);
    expect(result.drips).toBe(0);
  }
});

test('fat-cap dust stays faint next to an opaque outline core', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = globalThis.painting;
    p.reset(40, 'fat');
    p.line(100, 256, 400, 256, 200, 100);
    const pixels = p.strokeCtx.getImageData(100, 284, 300, 8).data;
    let strongestDust = 0;
    for (let i = 3; i < pixels.length; i += 4) strongestDust = Math.max(strongestDust, pixels[i]);
    return { strongestDust, core: p.pixel(p.strokeCtx, 256, 256)[3] };
  });
  expect(result.core).toBeGreaterThanOrEqual(190);
  expect(result.strongestDust).toBeLessThanOrEqual(50);
});

test('zero-opacity spraying cannot make paint or drips even when held', async ({ page }) => {
  const result = await page.evaluate(() => {
    const p = globalThis.painting;
    p.reset(40, 'fat', '#ffffff', 0);
    p.line(100, 256, 400, 256, 200, 20);
    p.hold(256, 256, 100, 30);
    return { paint: p.strokeCtx.getImageData(0, 0, 512, 512).data.some(value => value > 0), drips: p.drips.length };
  });
  expect(result.paint).toBe(false);
  expect(result.drips).toBe(0);
});

test('the actual train editor paints and undoes a stroke without any Firebase requests', async ({ page }) => {
  await page.route('**/*', route => {
    if (route.request().url().startsWith('http://127.0.0.1:5174/')) return route.continue();
    return route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem('graffbap_welcome_v1', '1');
    sessionStorage.setItem('graffbap_session', JSON.stringify({ yard: 'train', practice: true }));
  });
  await page.setViewportSize({ width: 1200, height: 700 });
  await page.goto('http://127.0.0.1:5174/#yard');
  await expect(page.locator('#practice-note')).toBeVisible();
  const point = { x: 600, y: 315 };
  const sample = () => page.locator('#viewport').evaluate((element, point) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const x = Math.floor((point.x - bounds.x) * canvas.width / bounds.width);
    const y = Math.floor((point.y - bounds.y) * canvas.height / bounds.height);
    return Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data);
  }, point);
  await expect.poll(async () => (await sample())[0]).toBeGreaterThan(30);
  const before = await sample();
  await page.mouse.move(500, point.y);
  await page.mouse.down();
  await page.mouse.move(700, point.y, { steps: 30 });
  await page.mouse.up();
  await expect(page.locator('#undo')).toBeEnabled();
  await expect.poll(async () => (await sample())[0] - before[0]).toBeGreaterThan(30);
  await page.locator('#undo').click();
  await expect.poll(async () => Math.abs((await sample())[0] - before[0])).toBeLessThan(5);
  await expect(page.locator('#practice-note')).toBeVisible();
  await expect(page.locator('#brush-hardness')).toHaveAttribute('aria-label', 'Edge');
  for (const tool of ['roller', 'mop', 'stamp']) {
    await page.locator(`[data-tool="${tool}"]`).click();
    await expect(page.locator('#edge-control')).not.toBeVisible();
  }
  await page.locator('[data-tool="paintball"]').click();
  await expect(page.locator('#brush-hardness')).toHaveAttribute('aria-label', 'Fire Rate');
  await expect(page.locator('#edge-control')).toBeVisible();
  for (const size of [{ width: 1200, height: 700 }, { width: 876, height: 473 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(size);
    const label = await page.locator('#edge-label').boundingBox();
    const slider = await page.locator('#brush-hardness').boundingBox();
    const output = await page.locator('output[for="brush-hardness"]').boundingBox();
    if (!label || !slider || !output) throw new Error('Fire Rate controls must remain visible.');
    expect(label.x + label.width).toBeLessThanOrEqual(slider.x);
    expect(slider.x + slider.width).toBeLessThanOrEqual(output.x);
    expect(slider.y).toBeLessThan(label.y + label.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator('[data-tool="buff"]').click();
  await expect(page.locator('#brush-hardness')).toHaveAttribute('aria-label', 'Edge');
});

test('soft and hard spray edges look measurably different while both cover the line center', async ({ page }) => {
  const results = await page.evaluate(() => {
    const p = globalThis.painting;
    return [0, 1].map(edge => {
      p.reset(40, 'fat'); p.setEdge(edge);
      p.line(100, 256, 400, 256, 200, 100);
      return { core: p.pixel(p.strokeCtx, 256, 256)[3], edge: p.pixel(p.strokeCtx, 256, 280)[3] };
    });
  });
  for (const result of results) expect(result.core).toBeGreaterThanOrEqual(185);
  expect(results[1].edge - results[0].edge).toBeGreaterThan(100);
});

test('continuous slow movement produces connected runs without stopping or releasing the mouse', async ({ page }) => {
  const results = await page.evaluate(() => {
    const p = globalThis.painting;
    return [30, 100, 300].map(steps => {
      p.reset(40, 'fat');
      p.line(256, 150, 256, 180, 3000, steps);
      return p.drips.map(d => ({ x: d.x, alpha: p.pixel(p.strokeCtx, Math.floor(d.x), Math.floor(d.startY))[3] }));
    });
  });
  for (const drips of results) {
    expect(drips.length).toBeGreaterThan(0);
    expect(drips.length).toBeLessThan(10);
    for (const drip of drips) {
      expect(Math.abs(drip.x - 256)).toBeLessThan(5);
      expect(drip.alpha).toBeGreaterThan(100);
    }
  }
});

test('roller runs connect to real lower edges for diagonal and rotated strokes, never empty bounding-box space', async ({ page }) => {
  const results = await page.evaluate(() => {
    const p = globalThis.painting;
    return [0, 45, 90, 135].map(angle => {
      p.reset(40, 'fat', '#ffffff', 1);
      const ctx = p.strokeCtx;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i <= 100; i++) {
        ctx.save(); ctx.translate(100 + i * 2.5, 140 + i);
        ctx.rotate(angle * Math.PI / 180); ctx.fillRect(-45, -3, 90, 6); ctx.restore();
      }
      // Try multiple releases because roller runs intentionally aren't guaranteed.
      for (let i = 0; i < 20; i++) p.spawnRollerRuns();
      return { angle, drips: p.drips.map(d => ({ x: d.x, y: d.startY,
        alpha: p.pixel(ctx, Math.floor(d.x), Math.floor(d.startY))[3] })) };
    });
  });
  for (const result of results) {
    expect(result.drips.length, `angle ${result.angle}`).toBeGreaterThan(0);
    for (const drip of result.drips) expect(drip.alpha).toBeGreaterThanOrEqual(128);
  }
});

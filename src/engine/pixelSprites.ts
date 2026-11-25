import type { AgentEntity, AgentRecord, Direction } from '../types/office.ts';
import {
  buildRamp,
  getProviderAccent,
  hashString,
  mixColors,
  rgba,
} from './colorUtils.ts';
import { SKY_PALETTES, type ResolvedPhase } from './lighting.ts';
import {
  FURNITURE,
  MAP_COLS,
  MAP_ROWS,
  TILE_SIZE,
  getTileKind,
  type FurnitureItem,
} from './officeMap.ts';

const OUTLINE = '#1b1726';
const WOOD_OUTLINE = '#2c1810';
const CANVAS_W = MAP_COLS * TILE_SIZE;
const CANVAS_H = MAP_ROWS * TILE_SIZE;

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function outlinedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  outline = OUTLINE,
  highlight?: string,
  shadow?: string
): void {
  const rx = Math.round(x);
  const ry = Math.round(y);
  const rw = Math.round(w);
  const rh = Math.round(h);
  if (rw < 2 || rh < 2) return;
  ctx.fillStyle = outline;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.fillStyle = fill;
  ctx.fillRect(rx + 1, ry + 1, rw - 2, rh - 2);
  if (highlight && rw > 2 && rh > 3) {
    ctx.fillStyle = highlight;
    ctx.fillRect(rx + 1, ry + 1, rw - 2, 1);
  }
  if (shadow && rw > 2 && rh > 3) {
    ctx.fillStyle = shadow;
    ctx.fillRect(rx + 1, ry + rh - 2, rw - 2, 1);
  }
}

// Offscreen static background cache (floors, walls, rugs, ambient occlusion)
let cachedStaticRoom: HTMLCanvasElement | null = null;

function renderStaticRoom(ctx: CanvasRenderingContext2D): void {
  const T = TILE_SIZE;

  // 1. Base outer frame & walls
  px(ctx, 0, 0, CANVAS_W, CANVAS_H, '#1d2233');

  // 2. Interior warm cream north wall (ty = 1, tx = 1..22)
  for (let tx = 1; tx < MAP_COLS - 1; tx++) {
    const x = tx * T;
    const y = T;
    // Top roof molding strip (ty = 0)
    px(ctx, x, 0, T, T, '#282f44');
    px(ctx, x, 0, T, 3, '#39435f');
    px(ctx, x, T - 4, T, 2, '#1d2233');
    px(ctx, x, T - 2, T, 2, '#6d4428');

    // Warm cream drywall (ty = 1)
    px(ctx, x, y, T, T, '#e2d5c1');
    // Subtle top shadow under crown molding
    px(ctx, x, y, T, 3, '#ccbba3');
    px(ctx, x, y + 3, T, 1, '#d8c9b3');
    // Subtle plaster vertical texture
    if (tx % 2 === 0) {
      px(ctx, x + 6, y + 5, 1, 14, '#dcd0bc');
      px(ctx, x + 22, y + 8, 1, 12, '#dcd0bc');
    }
    // Warm wooden baseboard / wainscot at bottom of north wall
    px(ctx, x, y + T - 7, T, 1, '#58331c');
    px(ctx, x, y + T - 6, T, 2, '#9a653c');
    px(ctx, x, y + T - 4, T, 3, '#734525');
    px(ctx, x, y + T - 1, T, 1, '#3b2111');
  }

  // Side walls (tx = 0, tx = MAP_COLS - 1) & bottom wall (ty = MAP_ROWS - 1)
  for (let ty = 0; ty < MAP_ROWS; ty++) {
    const y = ty * T;
    // Left wall
    px(ctx, 0, y, T, T, '#282f44');
    px(ctx, 0, y, 3, T, '#39435f');
    px(ctx, T - 6, y, 4, T, '#5e3921');
    px(ctx, T - 3, y, 2, T, '#8b5732');
    px(ctx, T - 1, y, 1, T, '#2c1810');

    // Right wall
    const rx = (MAP_COLS - 1) * T;
    px(ctx, rx, y, T, T, '#282f44');
    px(ctx, rx + T - 3, y, 3, T, '#1a1f2e');
    px(ctx, rx, y, 1, T, '#2c1810');
    px(ctx, rx + 1, y, 2, T, '#8b5732');
    px(ctx, rx + 3, y, 3, T, '#5e3921');
  }

  // Bottom wall trim
  const by = (MAP_ROWS - 1) * T;
  px(ctx, 0, by, CANVAS_W, T, '#282f44');
  px(ctx, T - 5, by, CANVAS_W - 2 * T + 10, 1, '#2c1810');
  px(ctx, T - 4, by + 1, CANVAS_W - 2 * T + 8, 3, '#8b5732');
  px(ctx, T - 4, by + 4, CANVAS_W - 2 * T + 8, 3, '#5e3921');
  px(ctx, T - 5, by + 7, CANVAS_W - 2 * T + 10, 1, '#1a1f2e');
  px(ctx, 0, CANVAS_H - 3, CANVAS_W, 3, '#1a1f2e');

  // Corner wood frame caps
  px(ctx, T - 6, T - 2, 6, 4, '#5e3921');
  px(ctx, (MAP_COLS - 1) * T, T - 2, 6, 4, '#5e3921');

  // 3. Staggered Vertical Honey-Oak Hardwood Floor (softer warm seams, clean readability)
  const plankWidth = 10;
  const plankColors = ['#c98d52', '#c18448', '#ce9358', '#ba7e43', '#c5894e'];
  const floorLeft = T;
  const floorTop = 2 * T;
  const floorRight = (MAP_COLS - 1) * T;
  const floorBottom = (MAP_ROWS - 1) * T;

  for (let pxX = floorLeft; pxX < floorRight; pxX += plankWidth) {
    const colIdx = Math.floor((pxX - floorLeft) / plankWidth);
    const stagger = ((colIdx * 19) % 44) + 14;
    let curY = floorTop;
    let segIdx = 0;

    while (curY < floorBottom) {
      const segLen = segIdx === 0 ? stagger : 46 + ((colIdx * 13 + segIdx * 23) % 28);
      const nextY = Math.min(floorBottom, curY + segLen);
      const h = nextY - curY;
      const wCol = Math.min(plankWidth, floorRight - pxX);
      const tone = plankColors[(colIdx * 3 + segIdx * 7) % plankColors.length];

      // Main plank body
      px(ctx, pxX, curY, wCol, h, tone);
      // Left soft bevel highlight
      if (wCol > 2) {
        px(ctx, pxX + 1, curY + 1, 1, Math.max(0, h - 2), mixColors(tone, '#f6d49c', 0.14));
      }
      // Subtle wood grain streak
      if (h > 14 && wCol > 5) {
        const grainX = pxX + 4 + ((colIdx + segIdx) % 3);
        px(ctx, grainX, curY + 6, 1, h - 12, mixColors(tone, '#965c29', 0.14));
      }
      // Warm vertical plank seam
      px(ctx, pxX + wCol - 1, curY, 1, h, '#9e6633');
      // Subtle horizontal butt joint seam
      if (nextY < floorBottom) {
        px(ctx, pxX, nextY - 1, wCol, 1, '#98602e');
        if (nextY + 2 < floorBottom) {
          px(ctx, pxX + 1, nextY, Math.max(0, wCol - 2), 1, mixColors(tone, '#f6d49c', 0.12));
        }
      }
      curY = nextY;
      segIdx++;
    }
  }

  // 4. Cafe Checkered Ceramic Floor (tx 15..22, ty 2..6)
  const cafeX = 15 * T;
  const cafeY = 2 * T;
  const cafeW = 8 * T;
  const cafeH = 5 * T;
  const sub = 16; // crisp 16x16 kitchen tiles like office-preview.jpg

  for (let cy = cafeY; cy < cafeY + cafeH; cy += sub) {
    for (let cx = cafeX; cx < cafeX + cafeW; cx += sub) {
      const ix = Math.floor((cx - cafeX) / sub);
      const iy = Math.floor((cy - cafeY) / sub);
      const isLight = (ix + iy) % 2 === 0;
      const base = isLight ? '#e4e8ee' : '#8d9aac';
      const hi = isLight ? '#f4f7fb' : '#a1aebf';
      const grout = isLight ? '#c2cbd6' : '#6f7c8f';

      px(ctx, cx, cy, sub, sub, base);
      px(ctx, cx + 1, cy + 1, sub - 2, 1, hi);
      px(ctx, cx + 1, cy + 1, 1, sub - 2, hi);
      px(ctx, cx, cy + sub - 1, sub, 1, grout);
      px(ctx, cx + sub - 1, cy, 1, sub, grout);
    }
  }

  // Wooden transition threshold around cafe floor
  px(ctx, cafeX - 2, cafeY, 3, cafeH + 2, '#694022');
  px(ctx, cafeX - 1, cafeY, 1, cafeH + 1, '#9f6b3f');
  px(ctx, cafeX - 2, cafeY + cafeH - 1, cafeW + 2, 3, '#694022');
  px(ctx, cafeX - 1, cafeY + cafeH, cafeW + 1, 1, '#9f6b3f');
  px(ctx, cafeX - 2, cafeY + cafeH + 2, cafeW + 2, 2, 'rgba(30, 15, 5, 0.18)');

  // 5. Ornate Persian Lounge Rug (tx 15..22, ty 8..13) — matching office-preview.jpg!
  const rugX = 15 * T + 4;
  const rugY = 8 * T + 4;
  const rugW = 8 * T - 8;
  const rugH = 6 * T - 8;

  // Rug grounded drop shadow
  px(ctx, rugX + 2, rugY + 2, rugW, rugH + 1, 'rgba(20, 10, 5, 0.25)');

  // Left & right golden fringe tassels
  for (let fy = rugY + 3; fy < rugY + rugH - 3; fy += 4) {
    px(ctx, rugX - 3, fy, 3, 2, '#e6c57f');
    px(ctx, rugX - 2, fy + 1, 2, 1, '#b88f46');
    px(ctx, rugX + rugW, fy, 3, 2, '#e6c57f');
    px(ctx, rugX + rugW, fy + 1, 2, 1, '#b88f46');
  }

  // Outer maroon border
  outlinedBox(ctx, rugX, rugY, rugW, rugH, '#88202c', '#4a1019', '#a62c3b', '#631520');
  // Gold filigree inner frame
  px(ctx, rugX + 4, rugY + 4, rugW - 8, rugH - 8, '#d99b38');
  px(ctx, rugX + 5, rugY + 5, rugW - 10, rugH - 10, '#f2c36b');
  px(ctx, rugX + 6, rugY + 6, rugW - 12, rugH - 12, '#7d1b27');
  // Main rich crimson field
  px(ctx, rugX + 10, rugY + 10, rugW - 20, rugH - 20, '#9e2634');
  // Second delicate golden pin-stripe border
  px(ctx, rugX + 12, rugY + 12, rugW - 24, 1, '#e6ae4c');
  px(ctx, rugX + 12, rugY + rugH - 13, rugW - 24, 1, '#e6ae4c');
  px(ctx, rugX + 12, rugY + 12, 1, rugH - 24, '#e6ae4c');
  px(ctx, rugX + rugW - 13, rugY + 12, 1, rugH - 24, '#e6ae4c');

  // Repeating geometric border diamonds in gold
  for (let dx = rugX + 8; dx < rugX + rugW - 10; dx += 10) {
    px(ctx, dx, rugY + 7, 3, 2, '#e8b34c');
    px(ctx, dx, rugY + rugH - 9, 3, 2, '#e8b34c');
  }
  for (let dy = rugY + 10; dy < rugY + rugH - 12; dy += 10) {
    px(ctx, rugX + 7, dy, 2, 3, '#e8b34c');
    px(ctx, rugX + rugW - 9, dy, 2, 3, '#e8b34c');
  }

  // Ornate corner motifs
  const corners = [
    [rugX + 14, rugY + 14],
    [rugX + rugW - 22, rugY + 14],
    [rugX + 14, rugY + rugH - 22],
    [rugX + rugW - 22, rugY + rugH - 22],
  ];
  for (const [cx, cy] of corners) {
    px(ctx, cx, cy, 8, 8, '#7a1925');
    px(ctx, cx + 2, cy + 2, 4, 4, '#e8b34c');
    px(ctx, cx + 3, cy + 3, 2, 2, '#9e2634');
  }

  // Subtle woven center medallion
  const medX = rugX + Math.floor(rugW / 2);
  const medY = rugY + Math.floor(rugH / 2);
  px(ctx, medX - 24, medY - 12, 48, 24, '#8d202d');
  px(ctx, medX - 20, medY - 9, 40, 18, '#b23240');
  px(ctx, medX - 14, medY - 6, 28, 12, '#d89b3b');
  px(ctx, medX - 11, medY - 4, 22, 8, '#962230');

  // Subtle carpet weave texture
  ctx.fillStyle = 'rgba(255, 224, 178, 0.05)';
  for (let wy = rugY + 14; wy < rugY + rugH - 14; wy += 4) {
    for (let wx = rugX + 14 + (wy % 8 === 0 ? 0 : 2); wx < rugX + rugW - 14; wx += 4) {
      ctx.fillRect(wx, wy, 1, 1);
    }
  }

  // 6. Room-wide Ambient Occlusion (soft shadows cast by walls onto floor)
  // North wall shadow
  px(ctx, floorLeft, floorTop, floorRight - floorLeft, 3, 'rgba(25, 14, 6, 0.24)');
  px(ctx, floorLeft, floorTop + 3, floorRight - floorLeft, 3, 'rgba(25, 14, 6, 0.11)');
  px(ctx, floorLeft, floorTop + 6, floorRight - floorLeft, 2, 'rgba(25, 14, 6, 0.05)');
  // West wall shadow
  px(ctx, floorLeft, floorTop, 3, floorBottom - floorTop, 'rgba(25, 14, 6, 0.18)');
  px(ctx, floorLeft + 3, floorTop, 3, floorBottom - floorTop, 'rgba(25, 14, 6, 0.07)');
  // East wall shadow
  px(ctx, floorRight - 3, floorTop, 3, floorBottom - floorTop, 'rgba(25, 14, 6, 0.16)');
  px(ctx, floorRight - 5, floorTop, 2, floorBottom - floorTop, 'rgba(25, 14, 6, 0.06)');
  // South wall inner bevel shadow
  px(ctx, floorLeft, floorBottom - 2, floorRight - floorLeft, 2, 'rgba(25, 14, 6, 0.12)');
}

function getStaticRoomCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (!cachedStaticRoom) {
    cachedStaticRoom = document.createElement('canvas');
    cachedStaticRoom.width = CANVAS_W;
    cachedStaticRoom.height = CANVAS_H;
    const sctx = cachedStaticRoom.getContext('2d');
    if (sctx) {
      sctx.imageSmoothingEnabled = false;
      renderStaticRoom(sctx);
    }
  }
  return cachedStaticRoom;
}

const WINDOW_GROUPS = [
  { startTx: 3, widthTiles: 3 },
  { startTx: 8, widthTiles: 3 },
  { startTx: 17, widthTiles: 3 },
];

export function drawOfficeFloorAndWalls(
  ctx: CanvasRenderingContext2D,
  clock: number,
  phase: ResolvedPhase = 'day'
): void {
  const staticCanvas = getStaticRoomCanvas();
  if (staticCanvas) {
    ctx.drawImage(staticCanvas, 0, 0);
  } else {
    renderStaticRoom(ctx);
  }

  // Draw animated panoramic windows on top of cached north wall
  const T = TILE_SIZE;
  const pal = SKY_PALETTES[phase];

  for (let wIdx = 0; wIdx < WINDOW_GROUPS.length; wIdx++) {
    const { startTx, widthTiles } = WINDOW_GROUPS[wIdx];
    const wx = startTx * T + 2;
    const wy = 14; // sits gracefully across upper wall/cream drywall like office-preview.jpg
    const ww = widthTiles * T - 4;
    const wh = 42;

    // Wall drop shadow under window frame
    px(ctx, wx + 2, wy + wh, ww - 2, 3, 'rgba(30, 18, 10, 0.25)');

    // Outer thick wooden window frame (3-tone beveled oak)
    outlinedBox(ctx, wx, wy, ww, wh, '#8c552d', WOOD_OUTLINE, '#b47544', '#5c3419');
    // Inner recessed frame border
    const gx = wx + 4;
    const gy = wy + 4;
    const gw = ww - 8;
    const gh = wh - 8;
    px(ctx, gx - 1, gy - 1, gw + 2, gh + 2, '#472611');

    // Clip sky + clouds + skyline inside glass pane
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, gw, gh);
    ctx.clip();

    // 3-band sky gradient
    const h1 = Math.floor(gh * 0.38);
    const h2 = Math.floor(gh * 0.34);
    px(ctx, gx, gy, gw, h1, pal.top);
    px(ctx, gx, gy + h1, gw, h2, pal.mid);
    px(ctx, gx, gy + h1 + h2, gw, gh - h1 - h2, pal.horizon);

    // Night twinkling stars & crescent moon
    if (pal.stars) {
      for (let s = 0; s < 11; s++) {
        const sx = gx + ((s * 23 + wIdx * 17) % (gw - 4)) + 2;
        const sy = gy + ((s * 11 + wIdx * 7) % Math.max(8, gh - 15)) + 2;
        const twinkle = Math.sin(clock * 2.5 + s * 1.9 + wIdx) > -0.2;
        if (twinkle) {
          px(ctx, sx, sy, 1, 1, s % 3 === 0 ? '#fde68a' : '#f8fafc');
        }
      }
      if (wIdx === 1) {
        // Crisp 7x7 pixel crescent moon in central window
        const mx = gx + gw - 16;
        const my = gy + 3;
        const moonRows = [
          '..XXX..',
          '.XXX...',
          'XXX....',
          'XXX....',
          '.XXX...',
          '..XXX..',
        ];
        for (let r = 0; r < moonRows.length; r++) {
          for (let c = 0; c < moonRows[r].length; c++) {
            if (moonRows[r][c] === 'X') {
              px(ctx, mx + c, my + r, 1, 1, c < 2 ? '#fef08a' : '#fde047');
            }
          }
        }
      }
    }

    // Drifting multi-layered pixel clouds
    const cloudSpan = gw + 36;
    for (let c = 0; c < 2; c++) {
      const speed = c === 0 ? 4.5 : 2.8;
      const offset = ((clock * speed + wIdx * 29 + c * 52) % cloudSpan) - 24;
      const cx = Math.round(gx + offset);
      const cy = gy + (c === 0 ? 5 : 11);
      // Cloud shadow base
      px(ctx, cx + 1, cy + 4, 18, 3, pal.cloudShadow);
      // Cloud fluffy pixel puffs
      px(ctx, cx, cy + 2, 20, 3, pal.cloudTop);
      px(ctx, cx + 3, cy, 12, 3, pal.cloudTop);
      px(ctx, cx + 6, cy - 1, 6, 2, pal.cloudTop);
    }

    // Occasional distant pixel bird flying across during day/sunset
    if (!pal.stars) {
      const birdCycle = (clock * 11 + wIdx * 47) % 190;
      if (birdCycle < gw + 10) {
        const bx = Math.round(gx + birdCycle - 5);
        const by = gy + 9 + Math.round(Math.sin(clock * 4 + wIdx) * 1.5);
        const wingUp = Math.floor(clock * 7 + wIdx) % 2 === 0;
        px(ctx, bx, by, 1, 1, '#334155');
        px(ctx, bx - 1, by + (wingUp ? -1 : 1), 1, 1, '#334155');
        px(ctx, bx + 1, by + (wingUp ? -1 : 1), 1, 1, '#334155');
      }
    }

    // Distant skyline silhouettes
    const bHeights = [10, 15, 8, 13, 17, 11, 14, 9, 12];
    for (let b = 0; b < bHeights.length; b++) {
      const bw = 10;
      const bh = bHeights[(b + wIdx * 2) % bHeights.length];
      const bx = gx + b * 10 - 2;
      const by = gy + gh - bh;
      px(ctx, bx, by, bw, bh, b % 2 === 0 ? pal.cityFar : pal.cityNear);
      // Lit city windows at sunset/night
      if (pal.cityWindow) {
        for (let wy2 = by + 2; wy2 < gy + gh - 5; wy2 += 3) {
          for (let wx2 = bx + 2; wx2 < bx + bw - 2; wx2 += 3) {
            if (((wx2 * 7 + wy2 * 13 + wIdx) % 5) < 2) {
              px(ctx, wx2, wy2, 1, 1, pal.cityWindow);
            }
          }
        }
      }
    }

    // Green treetops along bottom edge
    for (let tx2 = gx - 2; tx2 < gx + gw; tx2 += 9) {
      const th = 4 + ((tx2 + wIdx * 3) % 3);
      px(ctx, tx2, gy + gh - th, 10, th, pal.trees);
      px(ctx, tx2 + 2, gy + gh - th - 1, 6, 2, pal.treesHighlight);
    }

    // Subtle glass sheen diagonal lines
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.beginPath();
    ctx.moveTo(gx + 10, gy);
    ctx.lineTo(gx + 18, gy);
    ctx.lineTo(gx + 6, gy + gh);
    ctx.lineTo(gx - 2, gy + gh);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(gx + gw - 22, gy);
    ctx.lineTo(gx + gw - 17, gy);
    ctx.lineTo(gx + gw - 29, gy + gh);
    ctx.lineTo(gx + gw - 34, gy + gh);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // Wooden window sill ledge at bottom
    outlinedBox(ctx, wx - 2, wy + wh - 4, ww + 4, 5, '#a86a3a', WOOD_OUTLINE, '#ca8b56', '#693d1f');
  }

  // Keep tile query referenced cleanly for type safety if needed
  void getTileKind;
}

export interface DeskVisualInfo {
  working: boolean;
  accentColor: string;
}

export function drawFurnitureItem(
  ctx: CanvasRenderingContext2D,
  item: FurnitureItem,
  clock: number,
  deskInfoByIndex: Map<number, DeskVisualInfo>,
  lampsOn = false,
  anyAgentWorking = false
): void {
  const T = TILE_SIZE;
  const x = item.tx * T;
  const y = item.ty * T;
  const w = item.w * T;
  const h = item.h * T;

  switch (item.kind) {
    case 'wall_clock': {
      const cx = x + 16;
      const cy = y + 13;
      // Drop shadow
      px(ctx, cx - 6, cy - 5, 13, 13, 'rgba(30, 18, 10, 0.2)');
      // Outer rim
      px(ctx, cx - 7, cy - 6, 14, 12, WOOD_OUTLINE);
      px(ctx, cx - 6, cy - 7, 12, 14, WOOD_OUTLINE);
      px(ctx, cx - 6, cy - 5, 12, 10, '#7c4a26');
      px(ctx, cx - 5, cy - 6, 10, 12, '#9a6238');
      // Clock face
      px(ctx, cx - 5, cy - 4, 10, 8, '#f8fafc');
      px(ctx, cx - 4, cy - 5, 8, 10, '#f8fafc');
      // Cardinal ticks
      px(ctx, cx, cy - 4, 1, 1, '#475569');
      px(ctx, cx, cy + 4, 1, 1, '#475569');
      px(ctx, cx - 4, cy, 1, 1, '#475569');
      px(ctx, cx + 4, cy, 1, 1, '#475569');

      // Real-time hands
      const now = new Date();
      const mAngle = (now.getMinutes() / 60) * Math.PI * 2 - Math.PI / 2;
      const hAngle =
        (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * Math.PI * 2 - Math.PI / 2;

      ctx.save();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + Math.cos(mAngle) * 3.8, cy + 0.5 + Math.sin(mAngle) * 3.8);
      ctx.stroke();

      ctx.strokeStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(cx + 0.5, cy + 0.5);
      ctx.lineTo(cx + 0.5 + Math.cos(hAngle) * 2.6, cy + 0.5 + Math.sin(hAngle) * 2.6);
      ctx.stroke();
      ctx.restore();
      px(ctx, cx, cy, 1, 1, '#0f172a');
      break;
    }

    case 'wall_poster': {
      // Shadow
      px(ctx, x + 7, y + 6, 20, 17, 'rgba(30, 18, 10, 0.2)');
      // Wooden frame
      outlinedBox(ctx, x + 6, y + 5, 20, 17, '#7c4a26', WOOD_OUTLINE, '#a4693c', '#522e16');
      if (item.variant === 0) {
        // Mini pixel sunset mountain art
        px(ctx, x + 8, y + 7, 16, 5, '#fb923c');
        px(ctx, x + 8, y + 12, 16, 4, '#f472b6');
        px(ctx, x + 15, y + 8, 3, 3, '#fef08a');
        px(ctx, x + 8, y + 15, 16, 5, '#312e81');
        px(ctx, x + 10, y + 13, 6, 4, '#4338ca');
        px(ctx, x + 16, y + 12, 6, 5, '#3730a3');
      } else {
        // Mini pixel terminal code art
        px(ctx, x + 8, y + 7, 16, 13, '#0f172a');
        px(ctx, x + 10, y + 9, 5, 1, '#4ade80');
        px(ctx, x + 10, y + 11, 10, 1, '#38bdf8');
        px(ctx, x + 10, y + 13, 7, 1, '#a78bfa');
        px(ctx, x + 10, y + 15, 11, 1, '#fbbf24');
        px(ctx, x + 10, y + 17, 4, 1, '#4ade80');
      }
      break;
    }

    case 'corkboard': {
      px(ctx, x + 5, y + 6, 23, 17, 'rgba(30, 18, 10, 0.2)');
      outlinedBox(ctx, x + 4, y + 5, 23, 17, '#b57b47', WOOD_OUTLINE, '#cf945e', '#825128');
      px(ctx, x + 6, y + 7, 19, 13, '#c89259');
      // Colorful pinned post-it notes
      px(ctx, x + 7, y + 8, 5, 5, '#fef08a');
      px(ctx, x + 9, y + 8, 1, 1, '#ef4444');
      px(ctx, x + 13, y + 9, 5, 4, '#f9a8d4');
      px(ctx, x + 15, y + 9, 1, 1, '#3b82f6');
      px(ctx, x + 19, y + 8, 5, 5, '#7dd3fc');
      px(ctx, x + 21, y + 8, 1, 1, '#eab308');
      px(ctx, x + 9, y + 14, 6, 4, '#86efac');
      px(ctx, x + 16, y + 14, 6, 4, '#fed7aa');
      break;
    }

    case 'whiteboard': {
      // Shadow
      px(ctx, x + 3, y + 4, w - 4, h - 6, 'rgba(30, 18, 10, 0.22)');
      // Silver aluminum frame
      outlinedBox(ctx, x + 2, y + 2, w - 4, h - 7, '#cbd5e1', OUTLINE, '#f1f5f9', '#64748b');
      // Crisp white board surface
      px(ctx, x + 4, y + 4, w - 8, h - 11, '#f8fafc');
      px(ctx, x + 4, y + 4, w - 8, 1, '#e2e8f0');

      // Flowchart matching office-preview.jpg (blue start -> orange diamond -> green/pink nodes)
      // Top blue box
      outlinedBox(ctx, x + 25, y + 6, 12, 5, '#38bdf8', '#1e3a5f');
      // Connector down to orange diamond
      px(ctx, x + 31, y + 11, 1, 2, '#475569');
      px(ctx, x + 28, y + 13, 7, 3, '#fb923c');
      px(ctx, x + 30, y + 12, 3, 5, '#fb923c');
      // Left branch (green + purple)
      px(ctx, x + 14, y + 14, 14, 1, '#475569');
      outlinedBox(ctx, x + 7, y + 12, 9, 5, '#4ade80', '#14532d');
      px(ctx, x + 11, y + 17, 1, 2, '#475569');
      outlinedBox(ctx, x + 15, y + 18, 10, 4, '#a78bfa', '#3b0764');
      // Right branch (blue + coral)
      px(ctx, x + 35, y + 14, 8, 1, '#475569');
      outlinedBox(ctx, x + 42, y + 11, 11, 5, '#f472b6', '#831843');
      outlinedBox(ctx, x + 40, y + 18, 11, 4, '#60a5fa', '#1e3a8a');

      // Marker tray + eraser + colored markers
      outlinedBox(ctx, x + 10, y + h - 6, w - 20, 4, '#94a3b8', OUTLINE, '#e2e8f0', '#475569');
      px(ctx, x + 13, y + h - 5, 6, 2, '#1e293b'); // felt eraser
      px(ctx, x + 25, y + h - 5, 5, 1, '#ef4444');
      px(ctx, x + 33, y + h - 5, 5, 1, '#3b82f6');
      px(ctx, x + 41, y + h - 5, 5, 1, '#22c55e');
      break;
    }

    case 'desk': {
      const info =
        item.deskIndex !== undefined ? deskInfoByIndex.get(item.deskIndex) : undefined;
      const isWorking = Boolean(info?.working);
      const accent = info?.accentColor || '#38bdf8';

      // Grounded drop shadow
      px(ctx, x + 2, y + h - 3, w - 2, 7, 'rgba(20, 10, 4, 0.28)');
      px(ctx, x + 4, y + h + 3, w - 6, 2, 'rgba(20, 10, 4, 0.14)');

      // Desk legs (4 corners, shadowed)
      outlinedBox(ctx, x + 3, y + h - 9, 5, 10, '#6a3e1f', WOOD_OUTLINE, '#87512b', '#422410');
      outlinedBox(ctx, x + w - 8, y + h - 9, 5, 10, '#6a3e1f', WOOD_OUTLINE, '#87512b', '#422410');

      // Front modesty panel / apron under tabletop
      outlinedBox(ctx, x + 7, y + h - 9, w - 14, 7, '#7c4a26', WOOD_OUTLINE, '#6a3e1f', '#4f2c14');

      // Thick bevelled oak tabletop (3-tone pixel art)
      outlinedBox(ctx, x + 1, y + 3, w - 2, h - 8, '#c6874a', WOOD_OUTLINE, '#dfa364', '#9b612e');
      // Subtle wood grain lines on tabletop
      px(ctx, x + 6, y + 10, 18, 1, '#b5763c');
      px(ctx, x + 28, y + 17, 22, 1, '#b5763c');
      // Front bevel thickness lip
      px(ctx, x + 2, y + h - 8, w - 4, 2, '#9a5f2d');

      // === LEFT ZONE OF DESK: Desk lamp + mug + personalized clutter ===
      // Articulated desk lamp (x + 5..x + 17)
      outlinedBox(ctx, x + 5, y + 12, 7, 5, '#475569', OUTLINE, '#94a3b8', '#1e293b'); // lamp base
      px(ctx, x + 8, y + 6, 2, 7, '#334155'); // arm
      outlinedBox(
        ctx,
        x + 7,
        y + 3,
        9,
        5,
        lampsOn ? '#f59e0b' : '#475569',
        OUTLINE,
        lampsOn ? '#fde68a' : '#94a3b8',
        lampsOn ? '#d97706' : '#1e293b'
      );
      if (lampsOn) {
        px(ctx, x + 9, y + 8, 5, 2, '#fef08a'); // glowing bulb underside
        px(ctx, x + 7, y + 10, 10, 5, 'rgba(254, 240, 138, 0.22)');
      }

      // Desk mug (tinted slightly by agent provider accent)
      const mugX = x + 18;
      const mugY = y + 9;
      outlinedBox(ctx, mugX, mugY, 6, 6, '#f8fafc', OUTLINE, '#ffffff', '#cbd5e1');
      px(ctx, mugX + 5, mugY + 2, 2, 2, OUTLINE);
      px(ctx, mugX + 1, mugY + 1, 4, 2, '#6b3a1d'); // coffee inside
      px(ctx, mugX + 1, mugY + 4, 4, 1, accent); // accent stripe

      // Varied personal touch per desk (notebook, sticky notes, or tiny cactus)
      const dIdx = item.deskIndex ?? 0;
      if (dIdx % 3 === 0) {
        // Open mini notebook with blue cover
        outlinedBox(ctx, x + 6, y + 18, 12, 6, '#f8fafc', OUTLINE, '#ffffff', '#cbd5e1');
        px(ctx, x + 11, y + 19, 1, 4, '#94a3b8');
        px(ctx, x + 8, y + 20, 2, 1, '#3b82f6');
        px(ctx, x + 13, y + 20, 3, 1, '#64748b');
      } else if (dIdx % 3 === 1) {
        // Colorful sticky notes stack
        outlinedBox(ctx, x + 7, y + 18, 6, 5, '#fef08a', '#854d0e');
        outlinedBox(ctx, x + 14, y + 19, 5, 4, '#fbcfe8', '#831843');
      } else {
        // Tiny desk succulent
        outlinedBox(ctx, x + 8, y + 19, 6, 5, '#c2410c', WOOD_OUTLINE, '#ea580c');
        px(ctx, x + 9, y + 16, 4, 3, '#22c55e');
        px(ctx, x + 10, y + 15, 2, 2, '#86efac');
      }

      // === RIGHT ZONE OF DESK (CENTERED AT x + 46, ALIGNED WITH CHAIR & AGENT AT seatTx!) ===
      const mx = x + 33; // spans x+33 .. x+59 (center = x+46!)
      const my = y - 2;

      // Monitor stand & foot
      outlinedBox(ctx, mx + 8, my + 16, 10, 4, '#475569', OUTLINE, '#64748b', '#1e293b');
      px(ctx, mx + 11, my + 14, 4, 3, '#334155');

      // Monitor bezel (16-bit outlined crisp frame)
      outlinedBox(
        ctx,
        mx,
        my,
        26,
        16,
        '#2b3448',
        OUTLINE,
        '#4b5975',
        '#171d2b'
      );

      // Monitor display area
      if (isWorking) {
        // Glowing screen border halo
        ctx.fillStyle = rgba(accent, 0.25);
        ctx.fillRect(mx - 2, my - 2, 30, 20);

        px(ctx, mx + 2, my + 2, 22, 12, '#0b1220');
        // Animated syntax-highlighted code lines
        const scroll = Math.floor(clock * 7 + dIdx * 3);
        const linePalette = [accent, '#4ade80', '#e2e8f0', '#f472b6', '#38bdf8'];
        for (let row = 0; row < 4; row++) {
          const lineSeed = (scroll + row) % 5;
          const indent = row % 2 === 1 ? 3 : 0;
          const len = 6 + ((lineSeed * 5 + row * 3) % 11);
          px(
            ctx,
            mx + 4 + indent,
            my + 3 + row * 2.5,
            Math.min(18 - indent, len),
            1,
            linePalette[lineSeed]
          );
        }
        // Blinking terminal cursor
        if (Math.floor(clock * 4) % 2 === 0) {
          px(ctx, mx + 18, my + 11, 2, 2, accent);
        }
        // Bright active green power LED
        px(ctx, mx + 22, my + 14, 2, 1, '#4ade80');
      } else {
        // Standby dark screen with subtle diagonal reflection
        px(ctx, mx + 2, my + 2, 22, 12, '#1f293b');
        px(ctx, mx + 3, my + 3, 6, 1, '#334155');
        px(ctx, mx + 3, my + 4, 4, 1, '#334155');
        px(ctx, mx + 2, my + 12, 22, 2, '#151c29');
        // Subtle standby amber LED
        px(
          ctx,
          mx + 22,
          my + 14,
          2,
          1,
          Math.sin(clock * 2 + dIdx) > 0 ? '#fbbf24' : '#78350f'
        );
      }

      // Keyboard (centered at x + 46)
      outlinedBox(ctx, x + 36, y + 18, 19, 6, '#334155', OUTLINE, '#64748b', '#1e293b');
      // Key rows
      px(ctx, x + 38, y + 19, 15, 1, '#94a3b8');
      px(ctx, x + 38, y + 21, 12, 1, '#cbd5e1');
      px(ctx, x + 51, y + 21, 2, 1, accent); // accent enter key

      // Mousepad + Mouse
      px(ctx, x + 56, y + 18, 6, 6, '#1e293b');
      outlinedBox(ctx, x + 57, y + 19, 4, 5, '#cbd5e1', OUTLINE, '#f8fafc', '#64748b');
      break;
    }

    case 'chair': {
      // Base of swivel chair (tucked snugly up toward desk edge at y + 10!)
      const cx = x + 15;
      const cy = y + 10;
      // Soft floor shadow
      px(ctx, cx - 9, cy + 7, 18, 6, 'rgba(20, 10, 4, 0.22)');
      // 5-star caster wheels + legs
      px(ctx, cx - 7, cy + 10, 3, 2, OUTLINE);
      px(ctx, cx + 4, cy + 10, 3, 2, OUTLINE);
      px(ctx, cx - 1, cy + 11, 3, 2, OUTLINE);
      px(ctx, cx - 5, cy + 8, 11, 2, '#334155');
      px(ctx, cx - 1, cy + 5, 3, 5, '#1e293b');
      // Cushioned seat
      outlinedBox(ctx, cx - 8, cy - 4, 16, 10, '#3e4c63', OUTLINE, '#5a6c87', '#263040');
      // Side armrests
      outlinedBox(ctx, cx - 10, cy - 2, 3, 7, '#1e293b', OUTLINE, '#475569');
      outlinedBox(ctx, cx + 7, cy - 2, 3, 7, '#1e293b', OUTLINE, '#475569');
      // Draw backrest by default
      drawChairBackrest(ctx, item);
      break;
    }

    case 'bistro_table': {
      const cx = x + 16;
      const cy = y + 16;
      // Ground shadow
      ctx.fillStyle = 'rgba(20, 10, 4, 0.2)';
      ctx.beginPath();
      ctx.ellipse(cx, cy + 11, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Left & right little cafe stools
      outlinedBox(ctx, cx - 15, cy + 2, 7, 6, '#b45309', WOOD_OUTLINE, '#f59e0b', '#78350f');
      px(ctx, cx - 13, cy + 8, 2, 4, '#334155');
      outlinedBox(ctx, cx + 8, cy + 2, 7, 6, '#b45309', WOOD_OUTLINE, '#f59e0b', '#78350f');
      px(ctx, cx + 11, cy + 8, 2, 4, '#334155');
      // Central pedestal leg
      px(ctx, cx - 2, cy + 3, 4, 9, '#334155');
      px(ctx, cx - 5, cy + 11, 10, 2, OUTLINE);
      // Rounded wood tabletop
      outlinedBox(ctx, cx - 10, cy - 6, 20, 11, '#c6874a', WOOD_OUTLINE, '#e2a86b', '#8d5628');
      px(ctx, cx - 8, cy - 7, 16, 1, WOOD_OUTLINE);
      px(ctx, cx - 8, cy + 5, 16, 1, WOOD_OUTLINE);
      // Coffee cup + small plant bud on table
      outlinedBox(ctx, cx - 6, cy - 3, 5, 5, '#f8fafc', OUTLINE, '#ffffff');
      px(ctx, cx - 5, cy - 2, 3, 2, '#78350f');
      outlinedBox(ctx, cx + 2, cy - 3, 5, 5, '#fef08a', '#854d0e');
      break;
    }

    case 'printer': {
      // Shadow
      px(ctx, x + 3, y + h - 3, 26, 6, 'rgba(20, 10, 4, 0.24)');
      // Wooden printer cabinet stand
      outlinedBox(ctx, x + 3, y + 11, 26, 19, '#7c4a26', WOOD_OUTLINE, '#9b6236', '#4a2912');
      px(ctx, x + 6, y + 17, 20, 1, '#4a2912');
      px(ctx, x + 14, y + 14, 4, 1, '#cbd5e1');
      px(ctx, x + 14, y + 22, 4, 1, '#cbd5e1');
      // Multifunction office laser printer on top
      outlinedBox(ctx, x + 4, y + 1, 24, 12, '#cbd5e1', OUTLINE, '#f8fafc', '#64748b');
      // Paper input tray sticking out top
      outlinedBox(ctx, x + 9, y - 3, 14, 5, '#f8fafc', '#475569');
      // Output paper slot + control LEDs
      px(ctx, x + 7, y + 8, 14, 3, '#334155');
      px(ctx, x + 9, y + 9, 10, 2, '#f8fafc');
      px(ctx, x + 23, y + 5, 2, 2, Math.sin(clock * 3) > 0 ? '#4ade80' : '#15803d');
      break;
    }

    case 'counter': {
      // Drop shadow
      px(ctx, x + 2, y + h - 2, w - 2, 6, 'rgba(20, 10, 4, 0.22)');
      // Wooden cabinet base
      outlinedBox(ctx, x + 1, y + 9, w - 2, h - 9, '#7c4a26', WOOD_OUTLINE, '#9b6236', '#4a2912');
      // Cabinet doors & handles
      const doors = 3;
      const doorW = Math.floor((w - 10) / doors);
      for (let i = 0; i < doors; i++) {
        const dx = x + 5 + i * doorW;
        outlinedBox(ctx, dx, y + 13, doorW - 2, h - 16, '#8d562e', '#4d2a13', '#a66b3f');
        px(ctx, dx + doorW - 5, y + 18, 1, 4, '#e2e8f0');
      }
      // Countertop slab (bevelled stone/cream)
      outlinedBox(ctx, x, y + 3, w, 10, '#e2e8f0', OUTLINE, '#ffffff', '#94a3b8');
      // Cups & pastries on left/right sides of espresso machine
      outlinedBox(ctx, x + 6, y + 5, 6, 6, '#fb923c', OUTLINE, '#fed7aa');
      px(ctx, x + 7, y + 6, 4, 2, '#6b3a1d');
      outlinedBox(ctx, x + 15, y + 6, 6, 5, '#38bdf8', OUTLINE, '#bae6fd');
      // Small ceramic plate with donut/cookie on right
      outlinedBox(ctx, x + w - 18, y + 5, 11, 6, '#f8fafc', '#64748b');
      px(ctx, x + w - 15, y + 6, 5, 4, '#d97706');
      px(ctx, x + w - 14, y + 7, 3, 2, '#f472b6');
      break;
    }

    case 'coffee_machine': {
      // Detailed stainless-steel commercial espresso machine (matching office-preview.jpg)
      outlinedBox(ctx, x + 4, y - 4, 24, 22, '#475569', OUTLINE, '#94a3b8', '#1e293b');
      // Top cup warmer rack + mug on top
      px(ctx, x + 6, y - 3, 20, 2, '#cbd5e1');
      outlinedBox(ctx, x + 11, y - 9, 8, 6, '#f8fafc', OUTLINE, '#ffffff', '#cbd5e1');
      px(ctx, x + 12, y - 8, 6, 2, '#78350f');
      // Metallic control fascia
      px(ctx, x + 6, y, 20, 6, '#64748b');
      px(ctx, x + 7, y + 1, 18, 1, '#cbd5e1');
      // Pressure gauge + glowing LEDs
      px(ctx, x + 8, y + 2, 4, 3, '#f8fafc');
      px(ctx, x + 9, y + 3, 2, 1, '#dc2626');
      px(ctx, x + 15, y + 3, 2, 2, '#ef4444');
      px(ctx, x + 19, y + 3, 2, 2, Math.sin(clock * 4) > -0.3 ? '#22c55e' : '#15803d');
      px(ctx, x + 23, y + 3, 2, 2, '#38bdf8');
      // Brew recess + portafilter + steaming cup
      px(ctx, x + 7, y + 7, 18, 9, '#111827');
      px(ctx, x + 11, y + 7, 8, 2, '#334155'); // grouphead
      px(ctx, x + 14, y + 9, 2, 3, '#78350f'); // espresso stream
      outlinedBox(ctx, x + 11, y + 11, 8, 5, '#fef3c7', OUTLINE, '#ffffff');
      // Drip tray grate
      px(ctx, x + 6, y + 16, 20, 2, '#94a3b8');
      break;
    }

    case 'water_cooler': {
      // Shadow
      px(ctx, x + 7, y + h - 3, 18, 6, 'rgba(20, 10, 4, 0.22)');
      // Dispenser body
      outlinedBox(ctx, x + 6, y + 11, 20, 19, '#e2e8f0', OUTLINE, '#ffffff', '#94a3b8');
      // Recessed tap alcove
      outlinedBox(ctx, x + 9, y + 14, 14, 8, '#cbd5e1', '#64748b', '#94a3b8', '#f1f5f9');
      // Cold (blue) & Hot (red) taps
      px(ctx, x + 11, y + 16, 3, 3, '#2563eb');
      px(ctx, x + 11, y + 16, 2, 1, '#93c5fd');
      px(ctx, x + 18, y + 16, 3, 3, '#dc2626');
      px(ctx, x + 18, y + 16, 2, 1, '#fca5a5');
      // Drip grate
      px(ctx, x + 10, y + 21, 12, 1, '#475569');
      // Translucent 20L water jug on top
      outlinedBox(ctx, x + 8, y - 3, 16, 15, '#38bdf8', '#0c4a6e', '#7dd3fc', '#0284c7');
      // Horizontal bottle ribs
      px(ctx, x + 9, y + 2, 14, 1, '#0ea5e9');
      px(ctx, x + 9, y + 6, 14, 1, '#0ea5e9');
      // Curved specular glass highlight
      px(ctx, x + 10, y - 1, 3, 10, '#bae6fd');
      px(ctx, x + 11, y, 1, 7, '#f0f9ff');
      // Cap/neck
      px(ctx, x + 13, y + 10, 6, 2, '#0369a1');
      break;
    }

    case 'fridge': {
      // Shadow
      px(ctx, x + 4, y + h - 3, 24, 6, 'rgba(20, 10, 4, 0.24)');
      // Tall outlined fridge chassis (extends slightly up onto wall for 3/4 top-down depth!)
      outlinedBox(ctx, x + 3, y - 8, 26, 38, '#dce4ee', OUTLINE, '#f8fafc', '#94a3b8');
      // Top bevel highlight
      px(ctx, x + 5, y - 6, 22, 2, '#ffffff');
      // Freezer door seam
      px(ctx, x + 4, y + 6, 24, 1, '#64748b');
      px(ctx, x + 4, y + 7, 24, 1, '#f8fafc');
      // Metallic vertical handles
      outlinedBox(ctx, x + 23, y - 3, 3, 7, '#64748b', OUTLINE, '#e2e8f0');
      outlinedBox(ctx, x + 23, y + 10, 3, 9, '#64748b', OUTLINE, '#e2e8f0');
      // Cute fridge magnets / sticky notes (just like office-preview.jpg!)
      px(ctx, x + 7, y + 10, 4, 4, '#fef08a');
      px(ctx, x + 8, y + 10, 1, 1, '#ef4444');
      px(ctx, x + 13, y + 12, 4, 3, '#86efac');
      px(ctx, x + 8, y + 16, 3, 3, '#f9a8d4');
      // Bottom vent kickplate
      px(ctx, x + 5, y + 26, 22, 2, '#64748b');
      break;
    }

    case 'server_rack': {
      // Shadow
      px(ctx, x + 5, y + h - 3, 22, 6, 'rgba(20, 10, 4, 0.26)');
      // Tall dark steel AI server tower
      outlinedBox(ctx, x + 4, y - 6, 24, 36, '#1e293b', '#0b0e17', '#475569', '#0f172a');
      // 4 server rack blades
      for (let u = 0; u < 4; u++) {
        const uy = y - 2 + u * 7;
        outlinedBox(ctx, x + 6, uy, 20, 6, '#0f172a', '#334155');
        // Vent slots
        px(ctx, x + 8, uy + 2, 7, 1, '#334155');
        px(ctx, x + 8, uy + 4, 7, 1, '#334155');
        // Animated activity LEDs (blink faster when any agent is working!)
        const rate = anyAgentWorking ? 9 : 2.5;
        const onA = Math.sin(clock * rate + u * 2.1) > -0.2;
        const onB = Math.sin(clock * (rate * 1.4) + u * 3.7) > 0.1;
        px(ctx, x + 18, uy + 2, 2, 2, onA ? '#4ade80' : '#14532d');
        px(
          ctx,
          x + 21,
          uy + 2,
          2,
          2,
          onB ? (anyAgentWorking ? '#38bdf8' : '#fbbf24') : '#1e3a5f'
        );
      }
      // Subtle top status strip
      px(ctx, x + 7, y - 4, 18, 1, anyAgentWorking ? '#38bdf8' : '#475569');
      break;
    }

    case 'floor_lamp': {
      const cx = x + 16;
      // Shadow
      px(ctx, cx - 7, y + 23, 14, 5, 'rgba(20, 10, 4, 0.24)');
      // Brass base
      outlinedBox(ctx, cx - 6, y + 21, 12, 5, '#b45309', WOOD_OUTLINE, '#f59e0b', '#78350f');
      // Brass stem
      px(ctx, cx - 1, y + 4, 3, 18, '#92400e');
      px(ctx, cx, y + 4, 1, 18, '#fbbf24');
      // Warm fabric lamp shade
      const shadeFill = lampsOn ? '#fde68a' : '#e7dcc8';
      const shadeHi = lampsOn ? '#ffffff' : '#f8f4ec';
      const shadeSh = lampsOn ? '#f59e0b' : '#b8aa95';
      outlinedBox(ctx, cx - 7, y - 5, 14, 10, shadeFill, WOOD_OUTLINE, shadeHi, shadeSh);
      if (lampsOn) {
        px(ctx, cx - 5, y + 5, 10, 2, 'rgba(254, 240, 138, 0.55)');
      }
      break;
    }

    case 'sofa': {
      // Grounded shadow
      px(ctx, x + 2, y + h - 3, w - 2, 7, 'rgba(20, 10, 4, 0.28)');
      // Wooden feet
      px(ctx, x + 4, y + h - 2, 4, 3, WOOD_OUTLINE);
      px(ctx, x + w - 8, y + h - 2, 4, 3, WOOD_OUTLINE);
      // Plush crimson backrest
      outlinedBox(ctx, x + 2, y - 2, w - 4, 15, '#b91c1c', '#3b0910', '#ef4444', '#7f1d1d');
      // Backrest tufted vertical divisions (2 cushions like office-preview.jpg)
      const midX = x + Math.floor(w / 2);
      px(ctx, midX, y, 2, 12, '#7f1d1d');
      // Tufting buttons
      px(ctx, x + 22, y + 5, 2, 2, '#7f1d1d');
      px(ctx, x + 36, y + 5, 2, 2, '#7f1d1d');
      px(ctx, x + w - 24, y + 5, 2, 2, '#7f1d1d');
      px(ctx, x + w - 38, y + 5, 2, 2, '#7f1d1d');
      // Deep seat cushions
      outlinedBox(ctx, x + 7, y + 11, w - 14, 17, '#dc2626', '#3b0910', '#f87171', '#991b1b');
      px(ctx, midX, y + 12, 2, 15, '#7f1d1d');
      // Cozy cream-gold throw pillow on left corner
      outlinedBox(ctx, x + 10, y + 8, 10, 9, '#fef3c7', '#78350f', '#ffffff', '#eab308');
      // Rounded armrests
      outlinedBox(ctx, x + 1, y + 5, 8, 24, '#991b1b', '#3b0910', '#dc2626', '#6b0f18');
      outlinedBox(ctx, x + w - 9, y + 5, 8, 24, '#991b1b', '#3b0910', '#dc2626', '#6b0f18');
      break;
    }

    case 'sofa_side': {
      // Vertical red sofa against right wall facing left toward the coffee table!
      px(ctx, x + 2, y + h - 3, w - 2, 6, 'rgba(20, 10, 4, 0.28)');
      // Right backrest (against wall)
      outlinedBox(ctx, x + w - 11, y + 2, 10, h - 4, '#b91c1c', '#3b0910', '#ef4444', '#7f1d1d');
      // Seat cushions (left side)
      outlinedBox(ctx, x + 3, y + 7, w - 13, h - 14, '#dc2626', '#3b0910', '#f87171', '#991b1b');
      const midY = y + Math.floor(h / 2);
      px(ctx, x + 4, midY, w - 15, 2, '#7f1d1d');
      // Top & bottom armrests
      outlinedBox(ctx, x + 2, y + 1, w - 4, 8, '#991b1b', '#3b0910', '#dc2626', '#6b0f18');
      outlinedBox(ctx, x + 2, y + h - 9, w - 4, 8, '#991b1b', '#3b0910', '#dc2626', '#6b0f18');
      break;
    }

    case 'coffee_table': {
      // Shadow
      px(ctx, x + 5, y + h - 4, w - 8, 8, 'rgba(20, 10, 4, 0.28)');
      // Legs
      outlinedBox(ctx, x + 6, y + h - 8, 4, 8, '#5c3318', WOOD_OUTLINE);
      outlinedBox(ctx, x + w - 10, y + h - 8, 4, 8, '#5c3318', WOOD_OUTLINE);
      // Tabletop
      outlinedBox(ctx, x + 4, y + 5, w - 8, h - 10, '#be7d42', WOOD_OUTLINE, '#da9b5d', '#8a5223');
      // Subtle grain
      px(ctx, x + 10, y + 11, w - 24, 1, '#a86b35');
      // Magazine / tablet & coaster + mug
      outlinedBox(ctx, x + 12, y + 9, 13, 9, '#f8fafc', '#334155', '#ffffff', '#cbd5e1');
      px(ctx, x + 14, y + 11, 8, 2, '#3b82f6');
      px(ctx, x + 14, y + 14, 9, 1, '#94a3b8');
      px(ctx, x + 14, y + 16, 6, 1, '#94a3b8');
      // Warm mug on coaster
      px(ctx, x + 37, y + 12, 8, 6, '#78350f');
      outlinedBox(ctx, x + 38, y + 10, 6, 6, '#fbbf24', WOOD_OUTLINE, '#fef08a');
      px(ctx, x + 39, y + 11, 4, 2, '#5c2d0c');
      break;
    }

    case 'bookshelf': {
      // Shadow
      px(ctx, x + 2, y + h - 2, w - 2, 6, 'rgba(20, 10, 4, 0.26)');
      // Tall bookcase body extending slightly up for depth
      outlinedBox(ctx, x + 1, y - 8, w - 2, h + 7, '#754624', WOOD_OUTLINE, '#9b6236', '#4a2912');
      // Crown molding
      outlinedBox(ctx, x, y - 10, w, 4, '#8d562d', WOOD_OUTLINE, '#b07140', '#5a3217');

      // 3 Recessed shelves packed with books
      const bookColors = [
        '#ef4444',
        '#3b82f6',
        '#22c55e',
        '#f59e0b',
        '#a855f7',
        '#ec4899',
        '#14b8a6',
        '#f97316',
        '#6366f1',
      ];
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = y - 5 + shelf * 11;
        px(ctx, x + 4, sy, w - 8, 9, '#3a2112');
        // Wooden shelf plank underneath
        px(ctx, x + 3, sy + 9, w - 6, 2, '#9a6236');
        px(ctx, x + 3, sy + 10, w - 6, 1, '#5a3217');

        // Books of varied height + spine highlight
        let bx = x + 5;
        let bIdx = shelf * 5;
        while (bx < x + w - 8) {
          const bw = 4 + (bIdx % 2);
          const bh = 6 + ((bIdx * 3) % 3);
          const color = bookColors[bIdx % bookColors.length];
          if (shelf === 0 && bIdx === 4) {
            // Tiny potted succulent on top shelf!
            px(ctx, bx, sy + 5, 5, 4, '#c2410c');
            px(ctx, bx + 1, sy + 2, 3, 3, '#22c55e');
            px(ctx, bx + 2, sy + 1, 1, 2, '#86efac');
            bx += 7;
          } else {
            px(ctx, bx, sy + 9 - bh, bw, bh, color);
            px(ctx, bx, sy + 9 - bh, 1, bh, mixColors(color, '#ffffff', 0.25));
            px(ctx, bx + bw - 1, sy + 9 - bh, 1, bh, mixColors(color, '#000000', 0.3));
            px(ctx, bx + 1, sy + 10 - bh, bw - 2, 1, 'rgba(255,255,255,0.35)');
            bx += bw + 1;
          }
          bIdx++;
        }
      }
      break;
    }

    case 'plant': {
      const cx = x + 16;
      const sway = Math.round(Math.sin(clock * 1.7 + item.tx * 0.9 + item.ty) * 1);

      // Grounded ellipse shadow
      ctx.fillStyle = 'rgba(20, 10, 4, 0.24)';
      ctx.beginPath();
      ctx.ellipse(cx, y + 27, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // Detailed tapered terracotta pot
      outlinedBox(ctx, cx - 6, y + 17, 12, 11, '#c24f22', WOOD_OUTLINE, '#e26f3e', '#863010');
      px(ctx, cx - 5, y + 26, 10, 2, '#863010');
      // Pot rim
      outlinedBox(ctx, cx - 8, y + 13, 16, 5, '#d9602b', WOOD_OUTLINE, '#f38653', '#963813');
      // Soil visible inside rim
      px(ctx, cx - 6, y + 14, 12, 2, '#4a2a14');

      // Organic hand-crafted 16-bit leafy foliage matrix (dark outline + 3 green tones)
      const foliageA = [
        '.......oo.......',
        '......oLLo......',
        '...oo.oLGo.oo...',
        '..oLLooGGoLLo...',
        '..oGGLGGGLGGo...',
        '.ooDDGGGGDDGoo..',
        'oLLGGGGGGGGLLo..',
        'oGGDDGGGGDDGGo..',
        '.ooDDDDDDDDoo...',
        '..oLLGGGGLLo....',
        '.oGGDDGGDDGGo...',
        '..oooDDDDooo....',
        '....oDDDDoo.....',
      ];
      const foliageB = [
        '.....oo..oo.....',
        '....oLLooLLo....',
        '..oooGGLGGooo...',
        '.oLLGGGGGGLLo...',
        '.oGGDDGGDDGGo...',
        'oLLGGGGGGGGLLo..',
        'oGGDDGGGGDDGGo..',
        '.ooGGGGGGGGoo...',
        '..oDDGGGGDDo....',
        '...ooDDDDoo.....',
        '.....oooo.......',
      ];
      const sprite = item.variant === 1 ? foliageB : foliageA;
      const palMap: Record<string, string> = {
        o: '#0d2b18',
        D: '#15803d',
        G: '#22c55e',
        L: '#86efac',
      };
      const startX = cx - 8 + sway;
      const startY = y + (item.variant === 1 ? 4 : 2);
      for (let r = 0; r < sprite.length; r++) {
        const row = sprite[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          const col = palMap[ch];
          if (col) {
            px(ctx, startX + c, startY + r, 1, 1, col);
          }
        }
      }
      break;
    }
  }
}

/**
 * Draws ONLY the chair backrest so seated characters naturally nest inside the chair.
 */
export function drawChairBackrest(
  ctx: CanvasRenderingContext2D,
  item: FurnitureItem
): void {
  const T = TILE_SIZE;
  const cx = item.tx * T + 15;
  const cy = item.ty * T + 10;
  // Rounded office chair backrest (trimmed corners for ergonomic look)
  px(ctx, cx - 7, cy, 14, 1, OUTLINE);
  px(ctx, cx - 8, cy + 1, 16, 7, OUTLINE);
  px(ctx, cx - 7, cy + 8, 14, 1, OUTLINE);
  px(ctx, cx - 7, cy + 1, 14, 6, '#2b3547');
  px(ctx, cx - 6, cy + 1, 12, 1, '#566784');
  px(ctx, cx - 6, cy + 3, 12, 3, '#3b4860');
  px(ctx, cx - 6, cy + 7, 12, 1, '#141a26');
}

/**
 * Cute ambient office ginger tabby cat napping on the bottom-left edge of the lounge rug.
 */
export const OFFICE_CAT_POS = {
  x: 15.65 * TILE_SIZE,
  y: 13.05 * TILE_SIZE,
};

export function drawOfficeCat(ctx: CanvasRenderingContext2D, clock: number): void {
  const cx = Math.round(OFFICE_CAT_POS.x);
  const cy = Math.round(OFFICE_CAT_POS.y);
  const breathe = Math.sin(clock * 2.2) > 0.35 ? 1 : 0;
  const earTwitch = Math.sin(clock * 1.1) > 0.96 ? 1 : 0;
  const tailWag = Math.round(Math.sin(clock * 2.8));

  // Shadow
  px(ctx, cx - 7, cy + 3, 15, 4, 'rgba(20, 10, 4, 0.28)');

  // Curled-up tail
  outlinedBox(ctx, cx + 4, cy + 1 + (tailWag > 0 ? -1 : 0), 5, 3, '#ea580c', WOOD_OUTLINE, '#fb923c');

  // Sleeping tabby body
  outlinedBox(ctx, cx - 6, cy - 2 - breathe, 12, 7 + breathe, '#ea580c', WOOD_OUTLINE, '#fb923c', '#c2410c');
  // Ginger tabby stripes
  px(ctx, cx - 2, cy - 1 - breathe, 2, 3, '#9a3412');
  px(ctx, cx + 2, cy - 1 - breathe, 2, 3, '#9a3412');

  // Head tucked left
  outlinedBox(ctx, cx - 9, cy - 3, 7, 6, '#f97316', WOOD_OUTLINE, '#fdba74', '#c2410c');
  // Pointy ears
  px(ctx, cx - 9, cy - 5 + earTwitch, 2, 2, '#ea580c');
  px(ctx, cx - 8, cy - 4 + earTwitch, 1, 1, '#fda4af');
  px(ctx, cx - 5, cy - 5, 2, 2, '#ea580c');
  // Closed sleeping eyes + tiny pink nose
  px(ctx, cx - 8, cy - 1, 2, 1, WOOD_OUTLINE);
  px(ctx, cx - 5, cy - 1, 1, 1, WOOD_OUTLINE);
  px(ctx, cx - 7, cy + 1, 1, 1, '#fda4af');
}

function drawHair(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  dir: Direction,
  style: number,
  hairRamp: ReturnType<typeof buildRamp>
): void {
  const { highlight, base, shadow, outline } = hairRamp;

  if (dir === 'up') {
    // Full back of hair
    outlinedBox(ctx, hx - 1, hy - 2, 14, 11, base, outline, highlight, shadow);
    // Textured shading bands on back of head
    px(ctx, hx + 1, hy, 10, 2, highlight);
    px(ctx, hx + 1, hy + 5, 10, 2, shadow);
    if (style === 2) {
      // Long hair draping over shoulders
      outlinedBox(ctx, hx - 1, hy + 6, 14, 6, base, outline, base, shadow);
      px(ctx, hx + 2, hy + 7, 2, 4, highlight);
      px(ctx, hx + 8, hy + 7, 2, 4, shadow);
    } else if (style === 3) {
      // Fluffy curly crown
      outlinedBox(ctx, hx - 2, hy - 3, 16, 10, base, outline, highlight, shadow);
      px(ctx, hx, hy - 2, 3, 2, highlight);
      px(ctx, hx + 6, hy - 2, 4, 2, highlight);
    } else if (style === 1) {
      // Spiky tuft top
      px(ctx, hx + 2, hy - 4, 3, 2, base);
      px(ctx, hx + 6, hy - 4, 3, 2, highlight);
      px(ctx, hx + 9, hy - 3, 2, 2, shadow);
    }
    return;
  }

  if (dir === 'down') {
    if (style === 3) {
      // Curly / fluffy crown
      outlinedBox(ctx, hx - 2, hy - 3, 16, 6, base, outline, highlight, shadow);
      px(ctx, hx - 2, hy + 2, 3, 5, base);
      px(ctx, hx + 11, hy + 2, 3, 5, shadow);
      px(ctx, hx + 1, hy - 2, 3, 2, highlight);
      px(ctx, hx + 7, hy - 2, 3, 2, highlight);
    } else if (style === 2) {
      // Long hair framing both sides of face
      outlinedBox(ctx, hx - 1, hy - 2, 14, 5, base, outline, highlight, shadow);
      outlinedBox(ctx, hx - 2, hy + 1, 3, 10, base, outline, highlight, shadow);
      outlinedBox(ctx, hx + 11, hy + 1, 3, 10, base, outline, base, shadow);
      // Fringe bangs
      px(ctx, hx + 2, hy + 2, 3, 2, base);
      px(ctx, hx + 7, hy + 2, 3, 1, shadow);
    } else if (style === 1) {
      // Messy spiky hair
      outlinedBox(ctx, hx - 1, hy - 2, 14, 5, base, outline, highlight, shadow);
      px(ctx, hx + 1, hy - 4, 3, 2, base);
      px(ctx, hx + 5, hy - 4, 3, 2, highlight);
      px(ctx, hx + 9, hy - 3, 2, 2, shadow);
      px(ctx, hx - 1, hy + 2, 2, 4, base);
      px(ctx, hx + 11, hy + 2, 2, 4, shadow);
      px(ctx, hx + 3, hy + 2, 2, 2, base);
    } else if (style === 4) {
      // Neat bob with straight bangs
      outlinedBox(ctx, hx - 1, hy - 2, 14, 6, base, outline, highlight, shadow);
      px(ctx, hx - 1, hy + 2, 2, 7, base);
      px(ctx, hx + 11, hy + 2, 2, 7, shadow);
      px(ctx, hx + 1, hy + 3, 10, 1, shadow);
    } else {
      // Classic side-parted hair
      outlinedBox(ctx, hx - 1, hy - 2, 14, 5, base, outline, highlight, shadow);
      px(ctx, hx - 1, hy + 2, 2, 4, base);
      px(ctx, hx + 11, hy + 2, 2, 4, shadow);
      // Side part swoop
      px(ctx, hx + 1, hy + 2, 5, 2, base);
      px(ctx, hx + 2, hy, 4, 1, highlight);
    }
    return;
  }

  // Side profile ('left' or 'right')
  const facingRight = dir === 'right';
  const backX = facingRight ? hx - 1 : hx + 8;
  const frontX = facingRight ? hx + 8 : hx - 1;

  if (style === 3) {
    outlinedBox(ctx, hx - 2, hy - 3, 15, 6, base, outline, highlight, shadow);
    outlinedBox(ctx, backX - (facingRight ? 1 : 0), hy + 1, 5, 7, base, outline, highlight, shadow);
  } else {
    outlinedBox(ctx, hx - 1, hy - 2, 14, 5, base, outline, highlight, shadow);
    // Back of head hair coverage
    outlinedBox(ctx, backX, hy + 1, 5, style === 2 ? 10 : 7, base, outline, highlight, shadow);
    // Front fringe
    px(ctx, frontX, hy + 2, 3, 2, base);
    if (style === 1) {
      px(ctx, hx + 3, hy - 4, 3, 2, highlight);
      px(ctx, hx + 7, hy - 3, 3, 2, base);
    }
  }
}

export function drawAgentCharacter(
  ctx: CanvasRenderingContext2D,
  agent: AgentRecord,
  entity: AgentEntity,
  isSelected: boolean,
  isHovered: boolean,
  clock: number,
  isMeetingParticipant = false,
  isMeetingSpeaker = false
): void {
  const T = TILE_SIZE;
  const cx = entity.x * T;
  const cy = entity.y * T;

  const skin = buildRamp(agent.appearance.skinColor);
  const hair = buildRamp(agent.appearance.hairColor);
  const shirt = buildRamp(agent.appearance.shirtColor);
  const pants = buildRamp(agent.appearance.pantsColor);
  const { accessory } = agent.appearance;

  const idHash = hashString(`${agent.id}:${agent.name}`);
  const hairStyle = idHash % 5;

  const isMoving =
    entity.activity === 'walking_to_desk' ||
    entity.activity === 'walking_to_poi' ||
    entity.activity === 'walking_to_meeting';
  const isWorking = entity.activity === 'working';
  const isSeatedDesk = isWorking || entity.activity === 'idle_desk';
  const isTalking =
    isMeetingSpeaker ||
    (entity.activity === 'chatting' && Boolean(entity.bubbleText));

  // Smooth 4-phase walk cycle
  const walkPhase = isMoving ? Math.sin(entity.animTimer * 13) : 0;
  const walkBob = isMoving
    ? Math.abs(Math.sin(entity.animTimer * 13)) * 2
    : isSeatedDesk
      ? Math.sin(clock * 3 + (idHash % 7)) * 0.35
      : Math.sin(clock * 2.2 + (idHash % 7)) * 0.5;

  // Periodic natural eye blink (desynced per agent)
  const blinkCycle = (clock + (idHash % 100) * 0.17) % 4.3;
  const isBlinking = blinkCycle > 4.14;

  // Selection / hover / meeting speaker ground ring
  if (isSelected || isHovered || isMeetingSpeaker || isMeetingParticipant) {
    ctx.save();
    if (isMeetingSpeaker) {
      const pulse = 1 + Math.sin(clock * 6) * 0.14;
      ctx.fillStyle = 'rgba(167, 139, 250, 0.16)';
      ctx.beginPath();
      ctx.ellipse(cx + 16, cy + 25, 13 * pulse, 5.5 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#c4b5fd';
      ctx.lineWidth = 1.8;
      ctx.stroke();
    } else if (isSelected || isHovered) {
      ctx.fillStyle = isSelected
        ? 'rgba(56, 189, 248, 0.18)'
        : 'rgba(255, 255, 255, 0.1)';
      ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(cx + 16, cy + 25, 12, 5.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (isMeetingParticipant) {
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.55)';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.ellipse(cx + 16, cy + 25, 11, 4.8, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Grounded elliptical shadow (hidden/subtle when seated on chair)
  if (!isSeatedDesk) {
    ctx.fillStyle = 'rgba(18, 10, 6, 0.3)';
    ctx.beginPath();
    ctx.ellipse(cx + 16, cy + 26, 8.5, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Snug upward shift when seated at desk so shoulders & hands align cleanly with tabletop
  const seatShiftY = isSeatedDesk ? -7 : 0;
  const baseY = Math.round(cy - walkBob + seatShiftY);
  const bx = Math.round(cx);
  const dir = entity.dir;

  // === LEGS & SHOES ===
  if (isSeatedDesk) {
    // Tucked seated legs (chair backrest will overlay neatly on top)
    outlinedBox(ctx, bx + 10, baseY + 19, 5, 6, pants.shadow, OUTLINE, pants.base);
    outlinedBox(ctx, bx + 16, baseY + 19, 5, 6, pants.shadow, OUTLINE, pants.base);
  } else if (dir === 'left' || dir === 'right') {
    const stride = isMoving ? Math.round(walkPhase * 3) : 0;
    // Back leg
    outlinedBox(ctx, bx + 13 - stride, baseY + 19, 5, 7, pants.deep, OUTLINE, pants.shadow);
    px(ctx, bx + 13 - stride, baseY + 25, 5, 2, '#1e293b');
    // Front leg
    outlinedBox(ctx, bx + 13 + stride, baseY + 19, 5, 7, pants.base, OUTLINE, pants.highlight, pants.shadow);
    px(ctx, bx + 13 + stride + (dir === 'right' ? 1 : -1), baseY + 25, 6, 2, '#0f172a');
  } else {
    const leftStride = isMoving ? Math.round(walkPhase * 2) : 0;
    const rightStride = isMoving ? -Math.round(walkPhase * 2) : 0;
    outlinedBox(ctx, bx + 10, baseY + 19 + leftStride, 5, 7, pants.base, OUTLINE, pants.highlight, pants.shadow);
    outlinedBox(ctx, bx + 16, baseY + 19 + rightStride, 5, 7, pants.base, OUTLINE, pants.highlight, pants.shadow);
    // Shoes with crisp sole
    px(ctx, bx + 9, baseY + 25 + leftStride, 6, 2, '#0f172a');
    px(ctx, bx + 16, baseY + 25 + rightStride, 6, 2, '#0f172a');
    px(ctx, bx + 10, baseY + 25 + leftStride, 4, 1, '#334155');
    px(ctx, bx + 17, baseY + 25 + rightStride, 4, 1, '#334155');
  }

  // === TORSO & ARMS ===
  const typingShift = isWorking ? (Math.floor(clock * 14) % 2 === 0 ? -1 : 1) : 0;

  if (dir === 'left' || dir === 'right') {
    const armSwing = isMoving ? Math.round(walkPhase * 2.5) : 0;
    // Side torso (slightly narrower)
    outlinedBox(ctx, bx + 10, baseY + 11, 11, 10, shirt.base, OUTLINE, shirt.highlight, shirt.shadow);
    // Subtle collar/belt
    px(ctx, bx + 11, baseY + 19, 9, 1, '#1e293b');
    // Front swinging arm
    const armX = dir === 'right' ? bx + 13 + armSwing : bx + 14 - armSwing;
    outlinedBox(ctx, armX, baseY + 12, 4, 7, shirt.highlight, OUTLINE, shirt.highlight, shirt.shadow);
    px(ctx, armX + 1, baseY + 18, 2, 2, skin.base);
  } else {
    // Left arm
    const leftArmY = baseY + 12 + (isWorking ? typingShift - 2 : isMoving ? -Math.round(walkPhase * 2) : 0);
    const rightArmY = baseY + 12 + (isWorking ? -typingShift - 2 : isMoving ? Math.round(walkPhase * 2) : 0);

    outlinedBox(ctx, bx + 6, leftArmY, 4, 7, shirt.base, OUTLINE, shirt.highlight, shirt.shadow);
    px(ctx, bx + 7, leftArmY + 6, 2, 2, skin.base);

    // Right arm (lifted slightly if holding coffee/water)
    const holdLift = entity.holdingItem ? -2 : 0;
    outlinedBox(ctx, bx + 21, rightArmY + holdLift, 4, 7, shirt.base, OUTLINE, shirt.highlight, shirt.shadow);
    px(ctx, bx + 22, rightArmY + holdLift + 6, 2, 2, skin.base);

    // Torso shirt
    outlinedBox(ctx, bx + 9, baseY + 11, 13, 10, shirt.base, OUTLINE, shirt.highlight, shirt.shadow);
    // Collar detail
    if (dir === 'down') {
      px(ctx, bx + 13, baseY + 12, 5, 2, skin.shadow);
      px(ctx, bx + 14, baseY + 12, 3, 1, skin.base);
      // Shirt vertical seam / shading
      px(ctx, bx + 15, baseY + 14, 1, 5, shirt.shadow);
    } else {
      // Back shoulder highlight
      px(ctx, bx + 11, baseY + 12, 9, 1, shirt.highlight);
    }
    // Belt line
    px(ctx, bx + 10, baseY + 19, 11, 1, '#1e293b');
  }

  // === HELD ITEM (coffee mug or water cup) ===
  if (entity.holdingItem === 'coffee') {
    const hx = dir === 'left' ? bx + 5 : bx + 23;
    const hy = baseY + 14;
    outlinedBox(ctx, hx, hy, 6, 6, '#f8fafc', OUTLINE, '#ffffff', '#cbd5e1');
    px(ctx, hx + 1, hy + 1, 4, 2, '#78350f');
    px(ctx, hx + 1, hy + 4, 4, 1, getProviderAccent(agent.provider));
  } else if (entity.holdingItem === 'water') {
    const hx = dir === 'left' ? bx + 6 : bx + 23;
    const hy = baseY + 14;
    outlinedBox(ctx, hx, hy, 5, 6, '#38bdf8', '#0c4a6e', '#bae6fd', '#0284c7');
  }

  // === HEAD ===
  const hx = bx + 10;
  const hy = baseY + 1;
  outlinedBox(ctx, hx, hy, 12, 11, skin.base, OUTLINE, skin.highlight, skin.shadow);

  // Facial features
  if (dir === 'down') {
    // Ears
    px(ctx, hx - 1, hy + 5, 1, 3, skin.shadow);
    px(ctx, hx + 12, hy + 5, 1, 3, skin.shadow);
    // Subtle cheek blush
    px(ctx, hx + 2, hy + 7, 2, 1, mixColors(skin.base, '#f472b6', 0.25));
    px(ctx, hx + 8, hy + 7, 2, 1, mixColors(skin.base, '#f472b6', 0.25));

    // Expressive eyes with white catchlight + blinking
    if (isBlinking) {
      px(ctx, hx + 2, hy + 6, 2, 1, OUTLINE);
      px(ctx, hx + 8, hy + 6, 2, 1, OUTLINE);
    } else {
      px(ctx, hx + 2, hy + 5, 2, 2, '#0f172a');
      px(ctx, hx + 8, hy + 5, 2, 2, '#0f172a');
      px(ctx, hx + 2, hy + 5, 1, 1, '#ffffff');
      px(ctx, hx + 8, hy + 5, 1, 1, '#ffffff');
    }

    // Animated talking mouth
    if (isTalking && Math.floor(clock * 8) % 2 === 0) {
      px(ctx, hx + 5, hy + 8, 2, 2, '#7f1d1d');
    } else {
      px(ctx, hx + 5, hy + 8, 2, 1, skin.shadow);
    }
  } else if (dir === 'left' || dir === 'right') {
    const eyeX = dir === 'right' ? hx + 8 : hx + 2;
    const cheekX = dir === 'right' ? hx + 7 : hx + 3;
    const mouthX = dir === 'right' ? hx + 9 : hx + 2;
    // Side ear
    px(ctx, dir === 'right' ? hx + 3 : hx + 8, hy + 5, 2, 3, skin.shadow);
    px(ctx, cheekX, hy + 7, 2, 1, mixColors(skin.base, '#f472b6', 0.22));
    if (isBlinking) {
      px(ctx, eyeX, hy + 6, 2, 1, OUTLINE);
    } else {
      px(ctx, eyeX, hy + 5, 2, 2, '#0f172a');
      px(ctx, eyeX, hy + 5, 1, 1, '#ffffff');
    }
    if (isTalking && Math.floor(clock * 8) % 2 === 0) {
      px(ctx, mouthX, hy + 8, 2, 1, '#7f1d1d');
    }
  }

  // === HAIR ===
  drawHair(ctx, hx, hy, dir, hairStyle, hair);

  // === ACCESSORIES ===
  if (accessory === 'glasses' && dir !== 'up') {
    if (dir === 'down') {
      px(ctx, hx + 1, hy + 4, 4, 4, '#1e293b');
      px(ctx, hx + 7, hy + 4, 4, 4, '#1e293b');
      px(ctx, hx + 2, hy + 5, 2, 2, 'rgba(186, 230, 253, 0.55)');
      px(ctx, hx + 8, hy + 5, 2, 2, 'rgba(186, 230, 253, 0.55)');
      px(ctx, hx + 5, hy + 5, 2, 1, '#1e293b');
    } else {
      const gx = dir === 'right' ? hx + 7 : hx + 1;
      px(ctx, gx, hy + 4, 4, 4, '#1e293b');
      px(ctx, gx + 1, hy + 5, 2, 2, 'rgba(186, 230, 253, 0.55)');
      px(ctx, dir === 'right' ? hx + 4 : hx + 5, hy + 5, 3, 1, '#1e293b');
    }
  } else if (accessory === 'headphones') {
    const accent = getProviderAccent(agent.provider);
    // Headband over top
    px(ctx, hx, hy - 3, 12, 2, '#334155');
    px(ctx, hx + 2, hy - 3, 8, 1, '#94a3b8');
    // Padded earcups
    if (dir === 'down' || dir === 'up') {
      outlinedBox(ctx, hx - 2, hy + 3, 3, 6, '#334155', OUTLINE, accent);
      outlinedBox(ctx, hx + 11, hy + 3, 3, 6, '#334155', OUTLINE, accent);
    } else {
      const cupX = dir === 'right' ? hx + 2 : hx + 6;
      outlinedBox(ctx, cupX, hy + 3, 4, 6, '#334155', OUTLINE, accent);
    }
  } else if (accessory === 'cap') {
    const capColor = mixColors(agent.appearance.shirtColor, '#0f172a', 0.45);
    const capRamp = buildRamp(capColor);
    outlinedBox(ctx, hx - 1, hy - 3, 14, 5, capRamp.base, OUTLINE, capRamp.highlight, capRamp.shadow);
    // Directional visor brim
    if (dir === 'down') {
      outlinedBox(ctx, hx, hy + 1, 12, 3, capRamp.shadow, OUTLINE);
    } else if (dir === 'right') {
      outlinedBox(ctx, hx + 7, hy + 1, 8, 3, capRamp.shadow, OUTLINE);
    } else if (dir === 'left') {
      outlinedBox(ctx, hx - 3, hy + 1, 8, 3, capRamp.shadow, OUTLINE);
    }
  }

  // === MICRO PIXEL EMOTE ABOVE HEAD ===
  if (isMeetingSpeaker) {
    // Animated tiny purple sound-wave bars above speaker
    const bar1 = 2 + Math.round(Math.abs(Math.sin(clock * 11)) * 3);
    const bar2 = 2 + Math.round(Math.abs(Math.sin(clock * 11 + 1.5)) * 4);
    const bar3 = 2 + Math.round(Math.abs(Math.sin(clock * 11 + 3.0)) * 3);
    px(ctx, bx + 12, baseY - 6 - bar1, 2, bar1, '#c4b5fd');
    px(ctx, bx + 15, baseY - 6 - bar2, 2, bar2, '#ede9fe');
    px(ctx, bx + 18, baseY - 6 - bar3, 2, bar3, '#c4b5fd');
  } else if (entity.activity === 'walking_to_desk' && !entity.bubbleText) {
    // Tiny urgent yellow exclamation badge
    outlinedBox(ctx, bx + 13, baseY - 9, 6, 7, '#fef08a', OUTLINE);
    px(ctx, bx + 15, baseY - 8, 2, 3, '#b45309');
    px(ctx, bx + 15, baseY - 4, 2, 1, '#b45309');
  }
}

/**
 * Draws crisp HiDPI agent name badge directly on the high-resolution display canvas.
 */
export function drawAgentBadgeHiDPI(
  ctx: CanvasRenderingContext2D,
  agent: AgentRecord,
  entity: AgentEntity,
  isSelected: boolean,
  isHovered: boolean,
  scale: number
): void {
  const T = TILE_SIZE;
  const cx = (entity.x * T + 16) * scale;
  const cy = (entity.y * T + 31) * scale;

  ctx.save();
  const fontSize = Math.round(9.5 * scale);
  ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const label = agent.name;
  const textW = ctx.measureText(label).width;
  const dotR = 2.6 * scale;
  const padX = 5.5 * scale;
  const gap = 4 * scale;
  const badgeW = padX * 2 + dotR * 2 + gap + textW;
  const badgeH = 14 * scale;
  const bx = Math.round(cx - badgeW / 2);
  const by = Math.round(cy);

  // Subtle shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(bx, by + 1.2 * scale, badgeW, badgeH, 4 * scale);
  ctx.fill();

  // Pill background + crisp border
  ctx.fillStyle = isSelected
    ? 'rgba(2, 132, 199, 0.94)'
    : isHovered
      ? 'rgba(30, 41, 59, 0.94)'
      : 'rgba(15, 23, 42, 0.86)';
  ctx.strokeStyle = isSelected
    ? '#7dd3fc'
    : isHovered
      ? 'rgba(255, 255, 255, 0.5)'
      : 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = Math.max(1, 0.9 * scale);
  ctx.beginPath();
  ctx.roundRect(bx, by, badgeW, badgeH, 4 * scale);
  ctx.fill();
  ctx.stroke();

  // Status dot
  const dotColor =
    agent.status === 'working'
      ? '#4ade80'
      : agent.status === 'error'
        ? '#f87171'
        : '#fbbf24';
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(bx + padX + dotR, by + badgeH / 2, dotR, 0, Math.PI * 2);
  ctx.fill();

  // Crisp name text
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + padX + dotR * 2 + gap, by + badgeH / 2 + 0.4 * scale);
  ctx.restore();
}

export interface BubbleLayout {
  agent: AgentRecord;
  entity: AgentEntity;
  isMeetingSpeaker: boolean;
  text: string;
  anchorX: number;
  boxX: number;
  boxY: number;
  boxW: number;
  boxH: number;
}

/**
 * Computes non-overlapping crisp HiDPI speech bubbles, keeping glowing monitors visible!
 */
export function drawAgentBubblesHiDPI(
  ctx: CanvasRenderingContext2D,
  items: Array<{ agent: AgentRecord; entity: AgentEntity; isMeetingSpeaker: boolean }>,
  scale: number
): void {
  const T = TILE_SIZE;
  const maxW = CANVAS_W * scale;
  const fontSize = Math.round(8.8 * scale);
  const padX = 6.5 * scale;
  const boxH = 16.5 * scale;

  ctx.save();
  ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;

  const layouts: BubbleLayout[] = [];

  for (const { agent, entity, isMeetingSpeaker } of items) {
    const raw = isMeetingSpeaker
      ? `🎤 ${agent.currentActivity || 'Falando na reunião...'}`
      : agent.status === 'working'
        ? `💻 ${agent.currentActivity || 'Trabalhando...'}`
        : entity.bubbleText;

    if (!raw) continue;

    const maxChars = agent.status === 'working' ? 24 : 30;
    const text = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
    const textW = ctx.measureText(text).width;
    const boxW = textW + padX * 2;
    const isWorkingAtDesk = agent.status === 'working' && entity.activity === 'working';

    const anchorX = (entity.x * T + 16) * scale;
    // Float working bubbles ABOVE the monitor so the glowing screen stays visible!
    const anchorY = (entity.y * T - (isWorkingAtDesk ? 31 : 10)) * scale;

    const boxX = Math.max(
      4 * scale,
      Math.min(maxW - boxW - 4 * scale, Math.round(anchorX - boxW / 2))
    );
    const boxY = Math.max(4 * scale, Math.round(anchorY - boxH));

    layouts.push({
      agent,
      entity,
      isMeetingSpeaker,
      text,
      anchorX,
      boxX,
      boxY,
      boxW,
      boxH,
    });
  }

  // Resolve horizontal/vertical overlap between nearby bubbles
  layouts.sort((a, b) => a.boxY - b.boxY || a.boxX - b.boxX);
  const gap = 3 * scale;
  for (let i = 0; i < layouts.length; i++) {
    for (let j = 0; j < i; j++) {
      const cur = layouts[i];
      const prev = layouts[j];
      const overlapX = cur.boxX < prev.boxX + prev.boxW + gap && cur.boxX + cur.boxW + gap > prev.boxX;
      const overlapY = cur.boxY < prev.boxY + prev.boxH + gap && cur.boxY + cur.boxH + gap > prev.boxY;
      if (overlapX && overlapY) {
        const candidateUp = prev.boxY - cur.boxH - gap;
        if (candidateUp >= 4 * scale) {
          cur.boxY = candidateUp;
        } else {
          cur.boxY = prev.boxY + prev.boxH + gap;
        }
      }
    }
  }

  for (const b of layouts) {
    const darkBubble = b.agent.status === 'working' || b.isMeetingSpeaker;
    const accent = getProviderAccent(b.agent.provider);

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.beginPath();
    ctx.roundRect(b.boxX, b.boxY + 1.5 * scale, b.boxW, b.boxH, 4.5 * scale);
    ctx.fill();

    // Bubble body
    ctx.fillStyle = b.isMeetingSpeaker
      ? 'rgba(46, 16, 101, 0.96)'
      : darkBubble
        ? 'rgba(13, 20, 36, 0.93)'
        : 'rgba(255, 253, 248, 0.97)';
    ctx.strokeStyle = b.isMeetingSpeaker
      ? '#c4b5fd'
      : darkBubble
        ? accent
        : '#2c2538';
    ctx.lineWidth = Math.max(1.1, 1.2 * scale);

    ctx.beginPath();
    ctx.roundRect(b.boxX, b.boxY, b.boxW, b.boxH, 4.5 * scale);
    ctx.fill();
    ctx.stroke();

    // Small speech pointer tail
    const tipX = Math.max(
      b.boxX + 7 * scale,
      Math.min(b.boxX + b.boxW - 7 * scale, Math.round(b.anchorX))
    );
    const tailH = 3.8 * scale;
    ctx.beginPath();
    ctx.moveTo(tipX - 3 * scale, b.boxY + b.boxH - 0.5);
    ctx.lineTo(tipX + 3 * scale, b.boxY + b.boxH - 0.5);
    ctx.lineTo(tipX, b.boxY + b.boxH + tailH);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(tipX - 2.7 * scale, b.boxY + b.boxH - 1.3 * scale, 5.4 * scale, 1.8 * scale);

    ctx.fillStyle = b.isMeetingSpeaker
      ? '#f5f3ff'
      : darkBubble
        ? '#f0f9ff'
        : '#1e1b2e';
    ctx.textBaseline = 'middle';
    ctx.fillText(b.text, b.boxX + padX, b.boxY + b.boxH / 2 + 0.35 * scale);
  }

  ctx.restore();
}

export function getSortedFurniture(): FurnitureItem[] {
  return [...FURNITURE].sort((a, b) => a.ty - b.ty);
}

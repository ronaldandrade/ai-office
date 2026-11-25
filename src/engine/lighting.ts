import { rgba } from './colorUtils.ts';
import { DESK_SLOTS, MAP_COLS, MAP_ROWS, TILE_SIZE } from './officeMap.ts';

export type LightingMode = 'day' | 'sunset' | 'night' | 'auto';
export type ResolvedPhase = 'day' | 'sunset' | 'night';

export interface SkyPalette {
  top: string;
  mid: string;
  horizon: string;
  cloudTop: string;
  cloudShadow: string;
  cityFar: string;
  cityNear: string;
  cityWindow: string | null;
  trees: string;
  treesHighlight: string;
  stars: boolean;
  sunbeamColor: string;
  ambientOverlay: string | null;
  lampsOn: boolean;
}

export const SKY_PALETTES: Record<ResolvedPhase, SkyPalette> = {
  day: {
    top: '#4fb3f6',
    mid: '#87d4fa',
    horizon: '#cdeeff',
    cloudTop: '#ffffff',
    cloudShadow: '#cfe8f7',
    cityFar: '#8eb8d9',
    cityNear: '#6d99be',
    cityWindow: null,
    trees: '#4da85b',
    treesHighlight: '#7ed37e',
    stars: false,
    sunbeamColor: 'rgba(255, 248, 200, 0.14)',
    ambientOverlay: null,
    lampsOn: false,
  },
  sunset: {
    top: '#473672',
    mid: '#c75b7a',
    horizon: '#f7a45c',
    cloudTop: '#ffd6a5',
    cloudShadow: '#c76d85',
    cityFar: '#5d416a',
    cityNear: '#3b294d',
    cityWindow: '#ffe082',
    trees: '#355245',
    treesHighlight: '#7c7b48',
    stars: false,
    sunbeamColor: 'rgba(255, 174, 92, 0.16)',
    ambientOverlay: 'rgba(130, 56, 36, 0.16)',
    lampsOn: true,
  },
  night: {
    top: '#0c142c',
    mid: '#162447',
    horizon: '#23395d',
    cloudTop: '#334b73',
    cloudShadow: '#1e2f4f',
    cityFar: '#16213e',
    cityNear: '#0f172a',
    cityWindow: '#fde68a',
    trees: '#142d2b',
    treesHighlight: '#1f453e',
    stars: true,
    sunbeamColor: 'rgba(147, 197, 253, 0.08)',
    ambientOverlay: 'rgba(13, 21, 46, 0.44)',
    lampsOn: true,
  },
};

export function resolveLightingPhase(mode: LightingMode): ResolvedPhase {
  if (mode !== 'auto') return mode;
  const hour = new Date().getHours();
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'sunset';
  return 'night';
}

export interface WorkingDeskGlow {
  deskIndex: number;
  accentColor: string;
}

const CANVAS_W = MAP_COLS * TILE_SIZE;
const CANVAS_H = MAP_ROWS * TILE_SIZE;

function drawRadialGlow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  innerColor: string,
  outerColor: string
): void {
  const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(1, outerColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
}

export function drawLightingOverlay(
  ctx: CanvasRenderingContext2D,
  phase: ResolvedPhase,
  clock: number,
  workingDesks: Map<number, string>,
  meetingActive: boolean,
  meetingRunning: boolean
): void {
  const palette = SKY_PALETTES[phase];
  const T = TILE_SIZE;

  ctx.save();

  // 1. Ambient room tint for sunset / night
  if (palette.ambientOverlay) {
    ctx.fillStyle = palette.ambientOverlay;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  // 2. Window sunlight / moonlight beams across floor
  const beamAlphaPulse = 0.92 + Math.sin(clock * 0.7) * 0.08;
  ctx.save();
  ctx.globalAlpha = beamAlphaPulse;
  const windowRanges = [
    [3, 3],
    [8, 3],
    [17, 3],
  ];
  for (const [startTx, widthTiles] of windowRanges) {
    const x1 = startTx * T + 3;
    const x2 = (startTx + widthTiles) * T - 3;
    const yTop = 2 * T;
    const yBot = 4.6 * T;

    const grad = ctx.createLinearGradient(x1, yTop, x1 + 14, yBot);
    grad.addColorStop(0, palette.sunbeamColor);
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(x1, yTop);
    ctx.lineTo(x2, yTop);
    ctx.lineTo(x2 + 16, yBot);
    ctx.lineTo(x1 + 16, yBot);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 3. Additive warm lamps & vibrant working monitor glows
  ctx.globalCompositeOperation = 'lighter';

  // Desk lamps turn on during sunset / night
  if (palette.lampsOn) {
    const lampStrength = phase === 'night' ? 0.28 : 0.16;
    for (const slot of DESK_SLOTS) {
      const lx = slot.deskTx * T + 13;
      const ly = slot.deskTy * T + 8;
      drawRadialGlow(
        ctx,
        lx,
        ly,
        phase === 'night' ? 54 : 38,
        `rgba(255, 206, 120, ${lampStrength})`,
        'rgba(255, 190, 90, 0)'
      );
    }

    // Lounge floor lamp at (15, 8)
    drawRadialGlow(
      ctx,
      15 * T + 16,
      8 * T + 10,
      phase === 'night' ? 78 : 52,
      `rgba(255, 204, 118, ${phase === 'night' ? 0.3 : 0.18})`,
      'rgba(255, 184, 80, 0)'
    );

    // Cafe counter under-cabinet warm light
    drawRadialGlow(
      ctx,
      17.5 * T,
      2.6 * T,
      phase === 'night' ? 60 : 40,
      `rgba(255, 224, 165, ${phase === 'night' ? 0.18 : 0.1})`,
      'rgba(255, 224, 165, 0)'
    );
  }

  // Active working monitors emit colored screen bloom onto desk + agent
  for (const [deskIdx, accent] of workingDesks.entries()) {
    const slot = DESK_SLOTS[deskIdx];
    if (!slot) continue;
    const mx = slot.deskTx * T + 46;
    const my = slot.deskTy * T + 10;
    const flicker = 0.92 + Math.sin(clock * 8 + deskIdx * 2.1) * 0.08;
    const baseStrength = phase === 'night' ? 0.34 : phase === 'sunset' ? 0.26 : 0.2;
    drawRadialGlow(
      ctx,
      mx,
      my,
      phase === 'night' ? 52 : 38,
      rgba(accent, baseStrength * flicker),
      rgba(accent, 0)
    );
  }

  // Server rack LED ambient glow at (22, 2)
  const serverPulse = 0.12 + Math.sin(clock * 4.5) * 0.04;
  drawRadialGlow(
    ctx,
    22 * T + 16,
    2 * T + 14,
    phase === 'night' ? 32 : 20,
    `rgba(56, 189, 248, ${serverPulse})`,
    'rgba(56, 189, 248, 0)'
  );

  // Meeting room soft ambient spotlight
  if (meetingActive) {
    const pulse = meetingRunning ? 0.18 + Math.sin(clock * 3.2) * 0.05 : 0.11;
    drawRadialGlow(
      ctx,
      18 * T,
      11 * T,
      96,
      `rgba(167, 139, 250, ${pulse})`,
      'rgba(139, 92, 246, 0)'
    );
  }

  ctx.restore();
}

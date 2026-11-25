import type { ProviderId } from '../types/office.ts';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface ColorRamp {
  highlight: string;
  base: string;
  shadow: string;
  deep: string;
  outline: string;
}

const rampCache = new Map<string, ColorRamp>();

export function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function hexToRgb(hex: string): Rgb {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16) || 0,
      g: parseInt(clean[1] + clean[1], 16) || 0,
      b: parseInt(clean[2] + clean[2], 16) || 0,
    };
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (Number.isNaN(num)) return { r: 148, g: 163, b: 184 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return (
    '#' +
    clampByte(r).toString(16).padStart(2, '0') +
    clampByte(g).toString(16).padStart(2, '0') +
    clampByte(b).toString(16).padStart(2, '0')
  );
}

export function mixColors(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generates a 16-bit pixel-art color ramp with subtle warm-highlight / cool-shadow hue shifting.
 */
export function buildRamp(baseHex: string): ColorRamp {
  const cached = rampCache.get(baseHex);
  if (cached) return cached;

  const base = hexToRgb(baseHex);
  // Warm highlight (slight shift toward soft yellow-white)
  const highlight = rgbToHex({
    r: base.r + (255 - base.r) * 0.28 + 8,
    g: base.g + (250 - base.g) * 0.24 + 4,
    b: base.b + (232 - base.b) * 0.16,
  });

  // Cool shadow (slight shift toward deep indigo/plum)
  const shadow = rgbToHex({
    r: base.r * 0.72,
    g: base.g * 0.68,
    b: base.b * 0.78 + 8,
  });

  const deep = rgbToHex({
    r: base.r * 0.5,
    g: base.g * 0.46,
    b: base.b * 0.58 + 10,
  });

  const outline = rgbToHex({
    r: Math.min(48, base.r * 0.24 + 12),
    g: Math.min(42, base.g * 0.21 + 10),
    b: Math.min(62, base.b * 0.28 + 18),
  });

  const ramp: ColorRamp = {
    highlight,
    base: rgbToHex(base),
    shadow,
    deep,
    outline,
  };
  rampCache.set(baseHex, ramp);
  return ramp;
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const PROVIDER_ACCENT: Record<ProviderId, string> = {
  claude: '#fb923c',
  gemini: '#38bdf8',
  codex: '#4ade80',
  agy: '#a78bfa',
  aider: '#fbbf24',
  custom: '#f472b6',
  demo: '#22d3ee',
};

export function getProviderAccent(provider: ProviderId): string {
  return PROVIDER_ACCENT[provider] || '#38bdf8';
}

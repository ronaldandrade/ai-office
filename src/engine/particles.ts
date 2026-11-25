import { TILE_SIZE } from './officeMap.ts';

export type ParticleKind =
  | 'steam'
  | 'dust'
  | 'code'
  | 'footstep'
  | 'sparkle'
  | 'zzz'
  | 'bubble';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  phase: number;
}

const MAX_PARTICLES = 140;

const WINDOW_SUNBEAMS = [
  { xMin: 3 * TILE_SIZE + 8, xMax: 6 * TILE_SIZE + 8 },
  { xMin: 8 * TILE_SIZE + 8, xMax: 11 * TILE_SIZE + 8 },
  { xMin: 17 * TILE_SIZE + 8, xMax: 20 * TILE_SIZE + 8 },
];

export class ParticleSystem {
  private particles: Particle[] = [];
  private dustTimer = 0;
  private steamTimer = 0;
  private catZzzTimer = 0;
  private bubbleTimer = 0;

  clear(): void {
    this.particles.length = 0;
  }

  spawn(p: Omit<Particle, 'phase'> & { phase?: number }): void {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.shift();
    }
    this.particles.push({
      ...p,
      phase: p.phase ?? Math.random() * Math.PI * 2,
    });
  }

  spawnFootstep(wx: number, wy: number): void {
    for (let i = 0; i < 2; i++) {
      this.spawn({
        kind: 'footstep',
        x: wx + (Math.random() - 0.5) * 6,
        y: wy + (Math.random() - 0.5) * 2,
        vx: (Math.random() - 0.5) * 8,
        vy: -3 - Math.random() * 5,
        life: 0,
        maxLife: 0.45 + Math.random() * 0.25,
        size: 2,
        color: '#e7d5b8',
      });
    }
  }

  spawnCodeSpark(wx: number, wy: number, accentColor: string): void {
    this.spawn({
      kind: 'code',
      x: wx + (Math.random() - 0.5) * 18,
      y: wy,
      vx: (Math.random() - 0.5) * 4,
      vy: -9 - Math.random() * 6,
      life: 0,
      maxLife: 0.9 + Math.random() * 0.5,
      size: Math.random() < 0.5 ? 2 : 1,
      color: accentColor,
    });
  }

  spawnCompletionBurst(wx: number, wy: number): void {
    const colors = ['#4ade80', '#fde047', '#38bdf8', '#ffffff'];
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.3;
      const spd = 12 + Math.random() * 14;
      this.spawn({
        kind: 'sparkle',
        x: wx,
        y: wy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 6,
        life: 0,
        maxLife: 0.65 + Math.random() * 0.35,
        size: 2,
        color: colors[i % colors.length],
      });
    }
  }

  spawnMugSteam(wx: number, wy: number): void {
    this.spawn({
      kind: 'steam',
      x: wx + (Math.random() - 0.5) * 2,
      y: wy,
      vx: (Math.random() - 0.5) * 2,
      vy: -8 - Math.random() * 4,
      life: 0,
      maxLife: 0.8 + Math.random() * 0.4,
      size: 2,
      color: '#ffffff',
    });
  }

  update(dt: number, showSunDust: boolean, catX: number, catY: number): void {
    // Ambient sunbeam dust motes
    if (showSunDust) {
      this.dustTimer += dt;
      if (this.dustTimer >= 0.32) {
        this.dustTimer = 0;
        const beam =
          WINDOW_SUNBEAMS[Math.floor(Math.random() * WINDOW_SUNBEAMS.length)];
        this.spawn({
          kind: 'dust',
          x: beam.xMin + Math.random() * (beam.xMax - beam.xMin),
          y: 2 * TILE_SIZE + Math.random() * (2.2 * TILE_SIZE),
          vx: 2 + Math.random() * 3,
          vy: 1.5 + Math.random() * 2.5,
          life: 0,
          maxLife: 2.6 + Math.random() * 1.8,
          size: 1,
          color: '#fef3c7',
        });
      }
    }

    // Espresso machine ambient steam
    this.steamTimer += dt;
    if (this.steamTimer >= 0.28) {
      this.steamTimer = 0;
      this.spawn({
        kind: 'steam',
        x: 17 * TILE_SIZE + 14 + (Math.random() - 0.5) * 5,
        y: 2 * TILE_SIZE + 1,
        vx: (Math.random() - 0.5) * 2,
        vy: -10 - Math.random() * 5,
        life: 0,
        maxLife: 1.1 + Math.random() * 0.5,
        size: 2,
        color: '#f8fafc',
      });
    }

    // Water cooler rising bubble
    this.bubbleTimer += dt;
    if (this.bubbleTimer >= 1.15) {
      this.bubbleTimer = 0;
      this.spawn({
        kind: 'bubble',
        x: 20 * TILE_SIZE + 12 + Math.random() * 8,
        y: 2 * TILE_SIZE + 12,
        vx: 0,
        vy: -9,
        life: 0,
        maxLife: 0.9,
        size: 2,
        color: '#e0f2fe',
      });
    }

    // Sleeping office cat Zzz
    this.catZzzTimer += dt;
    if (this.catZzzTimer >= 2.2) {
      this.catZzzTimer = 0;
      this.spawn({
        kind: 'zzz',
        x: catX + 9,
        y: catY - 2,
        vx: 2.5,
        vy: -7,
        life: 0,
        maxLife: 1.6,
        size: 3,
        color: '#e2e8f0',
      });
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      if (p.kind === 'steam') {
        p.x += (p.vx + Math.sin(p.life * 6 + p.phase) * 4.5) * dt;
        p.y += p.vy * dt;
      } else if (p.kind === 'dust') {
        p.x += (p.vx + Math.sin(p.life * 2 + p.phase) * 2) * dt;
        p.y += (p.vy + Math.cos(p.life * 1.6 + p.phase) * 1.5) * dt;
      } else if (p.kind === 'sparkle') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 24 * dt; // subtle gravity
      } else {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const alpha =
        p.kind === 'dust'
          ? Math.sin(t * Math.PI) * 0.6
          : p.kind === 'steam'
            ? (1 - t) * 0.55
            : p.kind === 'footstep'
              ? (1 - t) * 0.5
              : (1 - t) * 0.9;

      if (alpha <= 0.02) continue;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;

      const rx = Math.round(p.x);
      const ry = Math.round(p.y);

      if (p.kind === 'zzz') {
        // Tiny 3x3 pixel 'z' glyph
        ctx.fillRect(rx, ry, 3, 1);
        ctx.fillRect(rx + 1, ry + 1, 1, 1);
        ctx.fillRect(rx, ry + 2, 3, 1);
      } else if (p.kind === 'sparkle' && t < 0.65) {
        // Crisp pixel cross sparkle
        ctx.fillRect(rx, ry - 1, 1, 3);
        ctx.fillRect(rx - 1, ry, 3, 1);
      } else if (p.kind === 'code') {
        ctx.fillRect(rx, ry, p.size + 1, 1);
      } else {
        ctx.fillRect(rx, ry, p.size, p.size);
      }
    }
    ctx.restore();
  }
}

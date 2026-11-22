import type { TilePoint } from '../types/office.ts';
import { MAP_COLS, MAP_ROWS, WALKABLE_GRID } from './officeMap.ts';

interface Node {
  tx: number;
  ty: number;
  g: number;
  f: number;
  parent?: Node;
}

function keyOf(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

export function findPath(
  startTx: number,
  startTy: number,
  goalTx: number,
  goalTy: number
): TilePoint[] {
  const sx = Math.max(0, Math.min(MAP_COLS - 1, Math.round(startTx)));
  const sy = Math.max(0, Math.min(MAP_ROWS - 1, Math.round(startTy)));
  const gx = Math.max(0, Math.min(MAP_COLS - 1, Math.round(goalTx)));
  const gy = Math.max(0, Math.min(MAP_ROWS - 1, Math.round(goalTy)));

  if (sx === gx && sy === gy) return [];
  if (!WALKABLE_GRID[gy]?.[gx]) return [];

  const open: Node[] = [
    { tx: sx, ty: sy, g: 0, f: Math.abs(gx - sx) + Math.abs(gy - sy) },
  ];
  const closed = new Set<string>();
  const bestG = new Map<string, number>([[keyOf(sx, sy), 0]]);

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (open.length > 0) {
    let bestIdx = 0;
    for (let i = 1; i < open.length; i++) {
      if (open[i].f < open[bestIdx].f) bestIdx = i;
    }
    const current = open.splice(bestIdx, 1)[0];
    const cKey = keyOf(current.tx, current.ty);

    if (current.tx === gx && current.ty === gy) {
      const path: TilePoint[] = [];
      let cur: Node | undefined = current;
      while (cur && !(cur.tx === sx && cur.ty === sy)) {
        path.push({ tx: cur.tx, ty: cur.ty });
        cur = cur.parent;
      }
      return path.reverse();
    }

    closed.add(cKey);

    for (const [dx, dy] of dirs) {
      const nx = current.tx + dx;
      const ny = current.ty + dy;
      if (nx < 0 || nx >= MAP_COLS || ny < 0 || ny >= MAP_ROWS) continue;
      if (!WALKABLE_GRID[ny][nx]) continue;
      const nKey = keyOf(nx, ny);
      if (closed.has(nKey)) continue;

      const ng = current.g + 1;
      const prevG = bestG.get(nKey);
      if (prevG === undefined || ng < prevG) {
        bestG.set(nKey, ng);
        const h = Math.abs(gx - nx) + Math.abs(gy - ny);
        open.push({ tx: nx, ty: ny, g: ng, f: ng + h, parent: current });
      }
    }
  }

  return [];
}

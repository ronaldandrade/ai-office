import type { Direction } from '../types/office.ts';

export const MAP_COLS = 24;
export const MAP_ROWS = 15;
export const TILE_SIZE = 32;

export type TileKind = 'wood' | 'carpet_lounge' | 'carpet_cafe' | 'wall' | 'window';

export interface DeskSlot {
  index: number;
  deskTx: number;
  deskTy: number;
  seatTx: number;
  seatTy: number;
  facing: Direction;
}

export interface PointOfInterest {
  id: string;
  kind: 'coffee' | 'water' | 'window' | 'whiteboard' | 'sofa' | 'plant' | 'chat';
  tx: number;
  ty: number;
  facing: Direction;
  label: string;
  partnerSpot?: { tx: number; ty: number; facing: Direction };
}

export interface FurnitureItem {
  id: string;
  kind:
    | 'desk'
    | 'chair'
    | 'coffee_machine'
    | 'counter'
    | 'water_cooler'
    | 'fridge'
    | 'sofa'
    | 'coffee_table'
    | 'plant'
    | 'bookshelf'
    | 'whiteboard'
    | 'rug_accent';
  tx: number;
  ty: number;
  w: number;
  h: number;
  solid: boolean;
  deskIndex?: number;
}

export const DESK_SLOTS: DeskSlot[] = [
  // Top row of desks
  { index: 0, deskTx: 2, deskTy: 4, seatTx: 3, seatTy: 5, facing: 'up' },
  { index: 1, deskTx: 6, deskTy: 4, seatTx: 7, seatTy: 5, facing: 'up' },
  { index: 2, deskTx: 10, deskTy: 4, seatTx: 11, seatTy: 5, facing: 'up' },
  // Bottom row of desks
  { index: 3, deskTx: 2, deskTy: 9, seatTx: 3, seatTy: 10, facing: 'up' },
  { index: 4, deskTx: 6, deskTy: 9, seatTx: 7, seatTy: 10, facing: 'up' },
  { index: 5, deskTx: 10, deskTy: 9, seatTx: 11, seatTy: 10, facing: 'up' },
];

export const FURNITURE: FurnitureItem[] = [
  // Desks (2x1) & Chairs (1x1 non-solid so characters can sit on them)
  ...DESK_SLOTS.flatMap((slot): FurnitureItem[] => [
    {
      id: `desk-${slot.index}`,
      kind: 'desk',
      tx: slot.deskTx,
      ty: slot.deskTy,
      w: 2,
      h: 1,
      solid: true,
      deskIndex: slot.index,
    },
    {
      id: `chair-${slot.index}`,
      kind: 'chair',
      tx: slot.seatTx,
      ty: slot.seatTy,
      w: 1,
      h: 1,
      solid: false,
      deskIndex: slot.index,
    },
  ]),

  // Cafe corner (top-right)
  { id: 'counter-1', kind: 'counter', tx: 16, ty: 2, w: 3, h: 1, solid: true },
  { id: 'coffee-1', kind: 'coffee_machine', tx: 17, ty: 2, w: 1, h: 1, solid: true },
  { id: 'water-1', kind: 'water_cooler', tx: 20, ty: 2, w: 1, h: 1, solid: true },
  { id: 'fridge-1', kind: 'fridge', tx: 21, ty: 2, w: 1, h: 1, solid: true },

  // Whiteboard on top-middle wall area
  { id: 'whiteboard-1', kind: 'whiteboard', tx: 13, ty: 1, w: 2, h: 1, solid: true },

  // Lounge area (bottom-right)
  { id: 'sofa-1', kind: 'sofa', tx: 17, ty: 9, w: 3, h: 1, solid: true },
  { id: 'table-1', kind: 'coffee_table', tx: 17, ty: 11, w: 2, h: 1, solid: true },
  { id: 'bookshelf-1', kind: 'bookshelf', tx: 21, ty: 8, w: 2, h: 1, solid: true },

  // Plants
  { id: 'plant-1', kind: 'plant', tx: 1, ty: 2, w: 1, h: 1, solid: true },
  { id: 'plant-2', kind: 'plant', tx: 1, ty: 13, w: 1, h: 1, solid: true },
  { id: 'plant-3', kind: 'plant', tx: 14, ty: 13, w: 1, h: 1, solid: true },
  { id: 'plant-4', kind: 'plant', tx: 22, ty: 13, w: 1, h: 1, solid: true },
];

export const POINTS_OF_INTEREST: PointOfInterest[] = [
  { id: 'poi-coffee', kind: 'coffee', tx: 17, ty: 3, facing: 'up', label: 'Máquina de Café' },
  { id: 'poi-water', kind: 'water', tx: 20, ty: 3, facing: 'up', label: 'Bebedouro' },
  { id: 'poi-window-1', kind: 'window', tx: 4, ty: 2, facing: 'up', label: 'Janela Oeste' },
  { id: 'poi-window-2', kind: 'window', tx: 9, ty: 2, facing: 'up', label: 'Janela Central' },
  { id: 'poi-whiteboard', kind: 'whiteboard', tx: 13, ty: 2, facing: 'up', label: 'Quadro Branco' },
  { id: 'poi-sofa-1', kind: 'sofa', tx: 18, ty: 10, facing: 'down', label: 'Sofá do Lounge' },
  { id: 'poi-sofa-2', kind: 'sofa', tx: 19, ty: 10, facing: 'down', label: 'Sofá do Lounge' },
  { id: 'poi-plant-1', kind: 'plant', tx: 2, ty: 2, facing: 'left', label: 'Planta do Escritório' },
  { id: 'poi-plant-2', kind: 'plant', tx: 14, ty: 12, facing: 'down', label: 'Planta do Lounge' },
  {
    id: 'poi-chat-lounge',
    kind: 'chat',
    tx: 16,
    ty: 6,
    facing: 'right',
    label: 'Bate-papo no Café',
    partnerSpot: { tx: 18, ty: 6, facing: 'left' },
  },
  {
    id: 'poi-chat-hall',
    kind: 'chat',
    tx: 7,
    ty: 7,
    facing: 'right',
    label: 'Bate-papo no Corredor',
    partnerSpot: { tx: 9, ty: 7, facing: 'left' },
  },
  {
    id: 'poi-chat-sofa',
    kind: 'chat',
    tx: 16,
    ty: 12,
    facing: 'right',
    label: 'Bate-papo no Lounge',
    partnerSpot: { tx: 18, ty: 12, facing: 'left' },
  },
];

export function getTileKind(tx: number, ty: number): TileKind {
  if (ty === 0) {
    if ((tx >= 3 && tx <= 5) || (tx >= 8 && tx <= 10) || (tx >= 17 && tx <= 19)) {
      return 'window';
    }
    return 'wall';
  }
  if (ty === 1) {
    if ((tx >= 3 && tx <= 5) || (tx >= 8 && tx <= 10) || (tx >= 17 && tx <= 19)) {
      return 'window';
    }
    return 'wall';
  }
  if (tx === 0 || tx === MAP_COLS - 1 || ty === MAP_ROWS - 1) {
    return 'wall';
  }
  if (tx >= 15 && tx <= 22 && ty >= 2 && ty <= 6) {
    return 'carpet_cafe';
  }
  if (tx >= 15 && tx <= 22 && ty >= 8 && ty <= 13) {
    return 'carpet_lounge';
  }
  return 'wood';
}

export function buildWalkableGrid(): boolean[][] {
  const grid: boolean[][] = [];
  for (let ty = 0; ty < MAP_ROWS; ty++) {
    const row: boolean[] = [];
    for (let tx = 0; tx < MAP_COLS; tx++) {
      const kind = getTileKind(tx, ty);
      row.push(kind !== 'wall' && kind !== 'window');
    }
    grid.push(row);
  }

  for (const item of FURNITURE) {
    if (!item.solid) continue;
    for (let dy = 0; dy < item.h; dy++) {
      for (let dx = 0; dx < item.w; dx++) {
        const gx = item.tx + dx;
        const gy = item.ty + dy;
        if (gy >= 0 && gy < MAP_ROWS && gx >= 0 && gx < MAP_COLS) {
          grid[gy][gx] = false;
        }
      }
    }
  }

  return grid;
}

export const WALKABLE_GRID = buildWalkableGrid();

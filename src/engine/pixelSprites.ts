import type { AgentEntity, AgentRecord } from '../types/office.ts';
import {
  FURNITURE,
  getTileKind,
  MAP_COLS,
  MAP_ROWS,
  TILE_SIZE,
  type FurnitureItem,
} from './officeMap.ts';

function px(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export function drawOfficeFloorAndWalls(
  ctx: CanvasRenderingContext2D,
  clock: number
): void {
  const T = TILE_SIZE;

  for (let ty = 0; ty < MAP_ROWS; ty++) {
    for (let tx = 0; tx < MAP_COLS; tx++) {
      const x = tx * T;
      const y = ty * T;
      const kind = getTileKind(tx, ty);

      if (kind === 'wood') {
        const alt = (tx + ty) % 2 === 0;
        px(ctx, x, y, T, T, alt ? '#c89d6c' : '#be9260');
        // Wood plank horizontal seams
        px(ctx, x, y + 7, T, 1, '#a97d4d');
        px(ctx, x, y + 15, T, 1, '#a97d4d');
        px(ctx, x, y + 23, T, 1, '#a97d4d');
        px(ctx, x, y + 31, T, 1, '#a47747');
        // Subtle plank joints
        px(ctx, x + ((tx * 11 + ty * 7) % 24) + 3, y, 1, 8, '#a97d4d');
        px(ctx, x + ((tx * 5 + ty * 13) % 24) + 3, y + 16, 1, 8, '#a97d4d');
      } else if (kind === 'carpet_cafe') {
        const checker = (tx + ty) % 2 === 0;
        px(ctx, x, y, T, T, checker ? '#e5dfd5' : '#d5cdc0');
        px(ctx, x, y + T - 1, T, 1, '#c3b9aa');
        px(ctx, x + T - 1, y, 1, T, '#c3b9aa');
      } else if (kind === 'carpet_lounge') {
        px(ctx, x, y, T, T, '#475569');
        if ((tx + ty) % 2 === 0) {
          px(ctx, x + 2, y + 2, T - 4, T - 4, '#4e5d73');
        }
        // Rug border
        if (tx === 15) px(ctx, x, y, 3, T, '#64748b');
        if (tx === 22) px(ctx, x + T - 3, y, 3, T, '#64748b');
        if (ty === 8) px(ctx, x, y, T, 3, '#64748b');
        if (ty === 13) px(ctx, x, y + T - 3, T, 3, '#64748b');
      } else if (kind === 'wall') {
        if (ty === 0) {
          px(ctx, x, y, T, T, '#2b3040');
          px(ctx, x, y + T - 4, T, 4, '#3d4459');
        } else if (ty === 1) {
          px(ctx, x, y, T, T, '#4b556b');
          px(ctx, x, y + T - 5, T, 5, '#353c4d');
          px(ctx, x, y + T - 1, T, 1, '#232836');
        } else {
          px(ctx, x, y, T, T, '#2b3040');
          px(ctx, x + 2, y + 2, T - 4, T - 4, '#373e52');
        }
      } else if (kind === 'window') {
        // Wall surround + sky view
        px(ctx, x, y, T, T, '#3d4459');
        if (ty === 0) {
          px(ctx, x, y, T, 6, '#2b3040');
          px(ctx, x, y + 6, T, T - 6, '#7dd3fc');
          // Drifting clouds
          const cloudOffset = ((clock * 8 + tx * 19) % 48) - 10;
          px(ctx, x + (cloudOffset % T), y + 12, 12, 4, '#f0f9ff');
          px(ctx, x + ((cloudOffset + 3) % T), y + 10, 8, 3, '#ffffff');
          // Window frame
          px(ctx, x, y + 6, T, 2, '#1e293b');
          px(ctx, x, y + 6, 2, T - 6, '#1e293b');
        } else {
          // Lower window pane with distant skyline/trees
          px(ctx, x, y, T, T - 6, '#bae6fd');
          px(ctx, x + 2, y + 10, 8, 16, '#93c5fd');
          px(ctx, x + 14, y + 6, 10, 20, '#7dd3fc');
          px(ctx, x + 4, y + 18, 24, 8, '#86efac');
          // Sill
          px(ctx, x, y + T - 6, T, 4, '#e2e8f0');
          px(ctx, x, y + T - 2, T, 2, '#475569');
          px(ctx, x, y, 2, T - 6, '#1e293b');
        }
      }
    }
  }

  // Soft sunlight beams falling onto floor below the 3 windows
  ctx.save();
  ctx.fillStyle = 'rgba(255, 250, 210, 0.12)';
  const windowRanges = [
    [3, 3],
    [8, 3],
    [17, 3],
  ];
  for (const [startTx, widthTiles] of windowRanges) {
    ctx.beginPath();
    ctx.moveTo(startTx * T + 2, 2 * T);
    ctx.lineTo((startTx + widthTiles) * T - 2, 2 * T);
    ctx.lineTo((startTx + widthTiles) * T + 12, 4.2 * T);
    ctx.lineTo(startTx * T + 14, 4.2 * T);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawFurnitureItem(
  ctx: CanvasRenderingContext2D,
  item: FurnitureItem,
  clock: number,
  workingDeskIndices: Set<number>
): void {
  const T = TILE_SIZE;
  const x = item.tx * T;
  const y = item.ty * T;
  const w = item.w * T;
  const h = item.h * T;

  switch (item.kind) {
    case 'desk': {
      const isWorking =
        item.deskIndex !== undefined && workingDeskIndices.has(item.deskIndex);
      // Drop shadow
      px(ctx, x + 3, y + h - 2, w - 4, 5, 'rgba(0,0,0,0.22)');
      // Desk body
      px(ctx, x + 2, y + 4, w - 4, h - 4, '#7c4d2b');
      px(ctx, x + 4, y + 6, w - 8, h - 10, '#9c663b');
      // Desk legs
      px(ctx, x + 4, y + h - 4, 4, 4, '#4a2e19');
      px(ctx, x + w - 8, y + h - 4, 4, 4, '#4a2e19');

      // Monitor
      const mx = x + 18;
      const my = y + 2;
      px(ctx, mx, my, 26, 15, '#1e293b');
      px(ctx, mx + 2, my + 2, 22, 11, isWorking ? '#0f172a' : '#334155');
      // Monitor stand
      px(ctx, mx + 10, my + 15, 6, 3, '#475569');
      px(ctx, mx + 7, my + 17, 12, 2, '#334155');

      if (isWorking) {
        // Animated glowing code lines!
        const scroll = Math.floor(clock * 6) % 4;
        px(ctx, mx + 4, my + 4, 10 + (scroll % 3) * 3, 2, '#38bdf8');
        px(ctx, mx + 4, my + 7, 14 - (scroll % 2) * 4, 2, '#4ade80');
        px(ctx, mx + 4, my + 10, 8 + ((scroll + 1) % 3) * 3, 2, '#f472b6');
        // Subtle screen glow
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.fillRect(mx - 2, my - 2, 30, 20);
      } else {
        // Standby LED
        px(ctx, mx + 21, my + 11, 2, 2, '#fbbf24');
      }

      // Keyboard
      px(ctx, x + 22, y + 21, 18, 5, '#cbd5e1');
      px(ctx, x + 24, y + 22, 14, 3, '#64748b');
      // Mouse
      px(ctx, x + 44, y + 22, 4, 5, '#e2e8f0');
      // Small desk mug
      px(ctx, x + 7, y + 10, 6, 6, '#f8fafc');
      px(ctx, x + 8, y + 11, 4, 3, '#78350f');
      break;
    }

    case 'chair': {
      px(ctx, x + 7, y + 6, 18, 18, 'rgba(0,0,0,0.16)');
      px(ctx, x + 8, y + 8, 16, 14, '#334155');
      px(ctx, x + 10, y + 10, 12, 10, '#475569');
      // Backrest
      px(ctx, x + 7, y + 20, 18, 5, '#1e293b');
      break;
    }

    case 'counter': {
      px(ctx, x + 2, y + 6, w - 4, h - 6, '#5c4033');
      px(ctx, x + 2, y + 4, w - 4, 14, '#e2e8f0');
      px(ctx, x + 4, y + 6, w - 8, 10, '#f8fafc');
      // Cups on counter
      px(ctx, x + 8, y + 8, 6, 6, '#fb923c');
      px(ctx, x + 17, y + 8, 6, 6, '#38bdf8');
      break;
    }

    case 'coffee_machine': {
      // Espresso machine on counter
      px(ctx, x + 7, y + 2, 18, 18, '#334155');
      px(ctx, x + 9, y + 4, 14, 7, '#0f172a');
      px(ctx, x + 11, y + 6, 3, 2, '#ef4444');
      px(ctx, x + 16, y + 6, 3, 2, '#22c55e');
      // Carafe / cup below
      px(ctx, x + 12, y + 13, 8, 6, '#78350f');
      // Animated steam particles
      const s1 = (clock * 14) % 10;
      const s2 = (clock * 14 + 5) % 10;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillRect(x + 13, y + 1 - s1, 2, 2);
      ctx.fillRect(x + 17, y + 2 - s2, 2, 2);
      break;
    }

    case 'water_cooler': {
      px(ctx, x + 8, y + 14, 16, 16, '#e2e8f0');
      px(ctx, x + 10, y + 16, 12, 6, '#cbd5e1');
      // Tap buttons
      px(ctx, x + 12, y + 19, 3, 3, '#3b82f6');
      px(ctx, x + 17, y + 19, 3, 3, '#ef4444');
      // Blue water jug on top
      px(ctx, x + 9, y + 2, 14, 12, '#38bdf8');
      px(ctx, x + 11, y + 4, 4, 8, '#bae6fd');
      // Occasional rising bubble
      const bubbleY = 10 - Math.floor((clock * 6) % 8);
      px(ctx, x + 17, y + 3 + bubbleY, 2, 2, '#e0f2fe');
      break;
    }

    case 'fridge': {
      px(ctx, x + 5, y + 1, 22, 29, '#cbd5e1');
      px(ctx, x + 7, y + 3, 18, 10, '#f1f5f9');
      px(ctx, x + 7, y + 15, 18, 13, '#e2e8f0');
      px(ctx, x + 22, y + 6, 2, 5, '#64748b');
      px(ctx, x + 22, y + 18, 2, 6, '#64748b');
      break;
    }

    case 'whiteboard': {
      px(ctx, x + 2, y + 2, w - 4, h - 6, '#94a3b8');
      px(ctx, x + 4, y + 4, w - 8, h - 10, '#f8fafc');
      // Drawn flowchart boxes
      px(ctx, x + 8, y + 8, 10, 6, '#38bdf8');
      px(ctx, x + 24, y + 8, 12, 6, '#34d399');
      px(ctx, x + 42, y + 10, 12, 6, '#f472b6');
      px(ctx, x + 18, y + 11, 6, 1, '#475569');
      px(ctx, x + 36, y + 12, 6, 1, '#475569');
      // Marker tray
      px(ctx, x + 12, y + h - 5, 20, 2, '#334155');
      break;
    }

    case 'sofa': {
      px(ctx, x + 3, y + h - 2, w - 4, 4, 'rgba(0,0,0,0.22)');
      // Backrest
      px(ctx, x + 2, y + 2, w - 4, 12, '#be123c');
      // Cushions
      px(ctx, x + 6, y + 12, w - 12, 16, '#e11d48');
      px(ctx, x + 32, y + 12, 2, 16, '#9f1239');
      px(ctx, x + 62, y + 12, 2, 16, '#9f1239');
      // Armrests
      px(ctx, x + 2, y + 6, 6, 22, '#9f1239');
      px(ctx, x + w - 8, y + 6, 6, 22, '#9f1239');
      break;
    }

    case 'coffee_table': {
      px(ctx, x + 6, y + 8, w - 12, h - 10, '#78350f');
      px(ctx, x + 8, y + 10, w - 16, h - 14, '#a16207');
      // Magazine & mug on table
      px(ctx, x + 14, y + 12, 10, 8, '#f8fafc');
      px(ctx, x + 16, y + 14, 6, 2, '#3b82f6');
      px(ctx, x + 38, y + 13, 6, 6, '#fbbf24');
      break;
    }

    case 'bookshelf': {
      px(ctx, x + 2, y + 2, w - 4, h - 2, '#5c3a21');
      px(ctx, x + 4, y + 4, w - 8, h - 6, '#3e2715');
      // Colorful books
      const bookColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899'];
      for (let i = 0; i < 10; i++) {
        px(ctx, x + 6 + i * 5, y + 6, 4, 10, bookColors[i % bookColors.length]);
        px(ctx, x + 6 + i * 5, y + 18, 4, 8, bookColors[(i + 2) % bookColors.length]);
      }
      break;
    }

    case 'plant': {
      // Shadow
      px(ctx, x + 8, y + 23, 16, 6, 'rgba(0,0,0,0.2)');
      // Terracotta pot
      px(ctx, x + 9, y + 17, 14, 11, '#c2410c');
      px(ctx, x + 7, y + 15, 18, 4, '#ea580c');
      // Leaves with gentle sway
      const sway = Math.round(Math.sin(clock * 1.8 + item.tx) * 1);
      px(ctx, x + 11 + sway, y + 5, 10, 10, '#16a34a');
      px(ctx, x + 6 + sway, y + 8, 8, 7, '#22c55e');
      px(ctx, x + 18 + sway, y + 8, 8, 7, '#15803d');
      px(ctx, x + 13 + sway, y + 2, 6, 6, '#4ade80');
      break;
    }
  }
}

export function drawAgentCharacter(
  ctx: CanvasRenderingContext2D,
  agent: AgentRecord,
  entity: AgentEntity,
  isSelected: boolean,
  isHovered: boolean,
  clock: number
): void {
  const T = TILE_SIZE;
  const cx = entity.x * T;
  const cy = entity.y * T;
  const { hairColor, skinColor, shirtColor, pantsColor, accessory } = agent.appearance;

  const isMoving =
    entity.activity === 'walking_to_desk' || entity.activity === 'walking_to_poi';
  const isWorking = entity.activity === 'working';
  const walkStep = isMoving ? Math.sin(entity.animTimer * 12) : 0;
  const bob = isMoving ? Math.abs(Math.sin(entity.animTimer * 12)) * 2 : Math.sin(clock * 2.5 + cx) * 0.6;

  // Selection / hover ring
  if (isSelected || isHovered) {
    ctx.save();
    ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx + 16, cy + 25, 13, 6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Ground shadow
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(cx + 16, cy + 26, 9, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  const baseY = cy - bob;

  // Legs / shoes
  const leftLegOffset = isMoving ? Math.round(walkStep * 2) : 0;
  const rightLegOffset = isMoving ? -Math.round(walkStep * 2) : 0;
  px(ctx, cx + 11, baseY + 20 + leftLegOffset, 4, 6, pantsColor);
  px(ctx, cx + 17, baseY + 20 + rightLegOffset, 4, 6, pantsColor);
  px(ctx, cx + 10, baseY + 25 + leftLegOffset, 5, 2, '#1e293b');
  px(ctx, cx + 17, baseY + 25 + rightLegOffset, 5, 2, '#1e293b');

  // Torso (shirt)
  px(ctx, cx + 9, baseY + 12, 14, 9, shirtColor);
  // Subtle shirt shading
  px(ctx, cx + 9, baseY + 19, 14, 2, 'rgba(0,0,0,0.18)');

  // Arms
  const typingOffset = isWorking ? (Math.floor(clock * 12) % 2 === 0 ? -1 : 1) : 0;
  px(ctx, cx + 6, baseY + 13 + (isWorking ? typingOffset : -leftLegOffset), 3, 7, shirtColor);
  px(ctx, cx + 23, baseY + 13 + (isWorking ? -typingOffset : -rightLegOffset), 3, 7, shirtColor);
  px(ctx, cx + 6, baseY + 19 + (isWorking ? typingOffset : -leftLegOffset), 3, 2, skinColor);
  px(ctx, cx + 23, baseY + 19 + (isWorking ? -typingOffset : -rightLegOffset), 3, 2, skinColor);

  // Held item (coffee mug or water cup)
  if (entity.holdingItem === 'coffee') {
    px(ctx, cx + 24, baseY + 16, 5, 5, '#f8fafc');
    px(ctx, cx + 25, baseY + 17, 3, 2, '#78350f');
    const steam = (clock * 10) % 6;
    px(ctx, cx + 26, baseY + 14 - steam, 1, 2, 'rgba(255,255,255,0.8)');
  } else if (entity.holdingItem === 'water') {
    px(ctx, cx + 24, baseY + 16, 4, 5, '#38bdf8');
    px(ctx, cx + 25, baseY + 17, 2, 3, '#bae6fd');
  }

  // Head
  px(ctx, cx + 9, baseY + 1, 14, 12, skinColor);

  // Hair
  px(ctx, cx + 8, baseY - 1, 16, 5, hairColor);
  if (entity.dir === 'up') {
    // Back of head covered with hair
    px(ctx, cx + 9, baseY + 2, 14, 9, hairColor);
  } else {
    px(ctx, cx + 8, baseY + 2, 2, 5, hairColor);
    px(ctx, cx + 22, baseY + 2, 2, 5, hairColor);
    // Eyes based on facing direction
    const eyeShift = entity.dir === 'left' ? -2 : entity.dir === 'right' ? 2 : 0;
    px(ctx, cx + 12 + eyeShift, baseY + 6, 2, 2, '#0f172a');
    px(ctx, cx + 18 + eyeShift, baseY + 6, 2, 2, '#0f172a');
  }

  // Accessories
  if (accessory === 'glasses' && entity.dir !== 'up') {
    const eyeShift = entity.dir === 'left' ? -2 : entity.dir === 'right' ? 2 : 0;
    px(ctx, cx + 11 + eyeShift, baseY + 5, 4, 4, 'rgba(15,23,42,0.45)');
    px(ctx, cx + 17 + eyeShift, baseY + 5, 4, 4, 'rgba(15,23,42,0.45)');
    px(ctx, cx + 15 + eyeShift, baseY + 6, 2, 1, '#0f172a');
  } else if (accessory === 'headphones') {
    px(ctx, cx + 7, baseY + 3, 2, 6, '#e2e8f0');
    px(ctx, cx + 23, baseY + 3, 2, 6, '#e2e8f0');
    px(ctx, cx + 9, baseY - 2, 14, 2, '#94a3b8');
  } else if (accessory === 'cap') {
    px(ctx, cx + 8, baseY - 2, 16, 4, '#0f172a');
    px(ctx, cx + 10, baseY + 1, 12, 2, '#1e293b');
  }

  // Name badge below feet
  ctx.save();
  ctx.font = '600 10px Inter, sans-serif';
  const label = agent.name;
  const textW = ctx.measureText(label).width;
  const badgeW = textW + 14;
  const badgeX = Math.round(cx + 16 - badgeW / 2);
  const badgeY = Math.round(cy + 29);

  ctx.fillStyle = isSelected ? 'rgba(14, 165, 233, 0.92)' : 'rgba(15, 23, 42, 0.82)';
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, badgeW, 14, 4);
  ctx.fill();

  // Status dot
  const dotColor =
    agent.status === 'working'
      ? '#4ade80'
      : agent.status === 'error'
        ? '#f87171'
        : '#fbbf24';
  ctx.fillStyle = dotColor;
  ctx.beginPath();
  ctx.arc(badgeX + 6, badgeY + 7, 2.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badgeX + 11, badgeY + 7.5);
  ctx.restore();
}

export function drawAgentBubble(
  ctx: CanvasRenderingContext2D,
  agent: AgentRecord,
  entity: AgentEntity
): void {
  const text =
    agent.status === 'working'
      ? `💻 ${agent.currentActivity || 'Trabalhando...'}`
      : entity.bubbleText;

  if (!text) return;

  const T = TILE_SIZE;
  const cx = entity.x * T + 16;
  const cy = entity.y * T - 10;

  ctx.save();
  ctx.font = '500 10.5px Inter, sans-serif';
  const clipped = text.length > 32 ? `${text.slice(0, 31)}…` : text;
  const textW = ctx.measureText(clipped).width;
  const padX = 8;
  const boxW = textW + padX * 2;
  const boxH = 20;
  const boxX = Math.max(4, Math.min(MAP_COLS * T - boxW - 4, Math.round(cx - boxW / 2)));
  const boxY = Math.max(4, Math.round(cy - boxH));

  ctx.fillStyle =
    agent.status === 'working'
      ? 'rgba(15, 23, 42, 0.94)'
      : 'rgba(255, 255, 255, 0.96)';
  ctx.strokeStyle = agent.status === 'working' ? '#38bdf8' : '#334155';
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.roundRect(boxX, boxY, boxW, boxH, 6);
  ctx.fill();
  ctx.stroke();

  // Speech pointer triangle
  const tipX = Math.max(boxX + 8, Math.min(boxX + boxW - 8, Math.round(cx)));
  ctx.beginPath();
  ctx.moveTo(tipX - 4, boxY + boxH);
  ctx.lineTo(tipX + 4, boxY + boxH);
  ctx.lineTo(tipX, boxY + boxH + 5);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = agent.status === 'working' ? '#e0f2fe' : '#0f172a';
  ctx.textBaseline = 'middle';
  ctx.fillText(clipped, boxX + padX, boxY + boxH / 2 + 0.5);
  ctx.restore();
}

export function getSortedFurniture(): FurnitureItem[] {
  return [...FURNITURE].sort((a, b) => a.ty - b.ty);
}

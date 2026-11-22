import React, { useEffect, useRef, useState } from 'react';
import type { AgentEntity, AgentRecord } from '../types/office.ts';
import { getActivityLabel, stepLifeSimulation } from './lifeSimulation.ts';
import { DESK_SLOTS, MAP_COLS, MAP_ROWS, TILE_SIZE } from './officeMap.ts';
import {
  drawAgentBubble,
  drawAgentCharacter,
  drawFurnitureItem,
  drawOfficeFloorAndWalls,
  getSortedFurniture,
} from './pixelSprites.ts';

interface OfficeCanvasProps {
  agents: AgentRecord[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  paused: boolean;
  simSpeed: number;
  onActivitiesUpdate?: (activities: Record<string, string>) => void;
}

const CANVAS_W = MAP_COLS * TILE_SIZE;
const CANVAS_H = MAP_ROWS * TILE_SIZE;
const SORTED_FURNITURE = getSortedFurniture();

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  paused,
  simSpeed,
  onActivitiesUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const entitiesRef = useRef<Map<string, AgentEntity>>(new Map());
  const agentsRef = useRef<AgentRecord[]>(agents);
  const selectedRef = useRef<string | null>(selectedAgentId);
  const hoveredRef = useRef<string | null>(null);
  const pausedRef = useRef(paused);
  const speedRef = useRef(simSpeed);
  const [hoveredAgentName, setHoveredAgentName] = useState<string | null>(null);

  agentsRef.current = agents;
  selectedRef.current = selectedAgentId;
  pausedRef.current = paused;
  speedRef.current = simSpeed;

  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let clock = 0;
    let activitySyncTimer = 0;

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      if (!pausedRef.current) {
        clock += dt * speedRef.current;
        stepLifeSimulation(dt, agentsRef.current, entitiesRef.current, speedRef.current);
      }

      activitySyncTimer += dt;
      if (activitySyncTimer > 0.6 && onActivitiesUpdate) {
        activitySyncTimer = 0;
        const map: Record<string, string> = {};
        for (const rec of agentsRef.current) {
          const ent = entitiesRef.current.get(rec.id);
          if (ent) {
            map[rec.id] = getActivityLabel(ent, rec);
          }
        }
        onActivitiesUpdate(map);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

          drawOfficeFloorAndWalls(ctx, clock);

          // Determine which desks have an actively working agent seated
          const workingDesks = new Set<number>();
          for (const rec of agentsRef.current) {
            const ent = entitiesRef.current.get(rec.id);
            if (rec.status === 'working' && ent?.activity === 'working') {
              workingDesks.add(rec.deskIndex % DESK_SLOTS.length);
            }
          }

          // Build depth-sorted render list (furniture + characters by Y)
          type Drawable = { ySort: number; draw: () => void };
          const drawables: Drawable[] = [];

          for (const item of SORTED_FURNITURE) {
            const ySort = item.kind === 'chair' ? item.ty - 0.2 : item.ty + item.h - 0.1;
            drawables.push({
              ySort,
              draw: () => drawFurnitureItem(ctx, item, clock, workingDesks),
            });
          }

          for (const rec of agentsRef.current) {
            const ent = entitiesRef.current.get(rec.id);
            if (!ent) continue;
            drawables.push({
              ySort: ent.y + 0.5,
              draw: () =>
                drawAgentCharacter(
                  ctx,
                  rec,
                  ent,
                  selectedRef.current === rec.id,
                  hoveredRef.current === rec.id,
                  clock
                ),
            });
          }

          drawables.sort((a, b) => a.ySort - b.ySort);
          for (const d of drawables) d.draw();

          // Draw speech/status bubbles on top of everything
          for (const rec of agentsRef.current) {
            const ent = entitiesRef.current.get(rec.id);
            if (!ent) continue;
            drawAgentBubble(ctx, rec, ent);
          }
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [onActivitiesUpdate]);

  const hitTestAgent = (e: React.MouseEvent<HTMLCanvasElement>): AgentRecord | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    for (const rec of agentsRef.current) {
      const ent = entitiesRef.current.get(rec.id);
      if (!ent) continue;
      const ax = ent.x * TILE_SIZE;
      const ay = ent.y * TILE_SIZE;
      if (mx >= ax - 4 && mx <= ax + TILE_SIZE + 4 && my >= ay - 6 && my <= ay + TILE_SIZE + 12) {
        return rec;
      }
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestAgent(e);
    hoveredRef.current = hit ? hit.id : null;
    setHoveredAgentName(hit ? `${hit.name} — ${hit.roleTitle}` : null);
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitTestAgent(e);
    if (hit) {
      onSelectAgent(hit.id);
    }
  };

  return (
    <div className="office-stage">
      <div className="office-canvas-frame">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className={`office-canvas ${hoveredAgentName ? 'is-pointer' : ''}`}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => {
            hoveredRef.current = null;
            setHoveredAgentName(null);
          }}
          onClick={handleClick}
        />
        {hoveredAgentName && (
          <div className="canvas-hover-pill">
            Clique para abrir: <strong>{hoveredAgentName}</strong>
          </div>
        )}
      </div>
      <div className="office-legend">
        <span>☕ Café</span>
        <span>💧 Bebedouro</span>
        <span>🌤️ Janelas</span>
        <span>💬 Bate-papo</span>
        <span>💻 Clique em um personagem para enviar tarefas</span>
      </div>
    </div>
  );
};

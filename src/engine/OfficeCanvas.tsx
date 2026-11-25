import React, { useEffect, useRef, useState } from 'react';
import type { AgentEntity, AgentRecord, MeetingState } from '../types/office.ts';
import { getProviderAccent } from './colorUtils.ts';
import { getActivityLabel, stepLifeSimulation } from './lifeSimulation.ts';
import {
  SKY_PALETTES,
  drawLightingOverlay,
  resolveLightingPhase,
  type LightingMode,
} from './lighting.ts';
import { DESK_SLOTS, MAP_COLS, MAP_ROWS, TILE_SIZE, type FurnitureItem } from './officeMap.ts';
import { ParticleSystem } from './particles.ts';
import {
  OFFICE_CAT_POS,
  drawAgentBadgeHiDPI,
  drawAgentBubblesHiDPI,
  drawAgentCharacter,
  drawChairBackrest,
  drawFurnitureItem,
  drawOfficeCat,
  drawOfficeFloorAndWalls,
  getSortedFurniture,
  type DeskVisualInfo,
} from './pixelSprites.ts';

interface OfficeCanvasProps {
  agents: AgentRecord[];
  meeting: MeetingState;
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string) => void;
  paused: boolean;
  simSpeed: number;
  onActivitiesUpdate?: (activities: Record<string, string>) => void;
}

const CANVAS_W = MAP_COLS * TILE_SIZE; // 768
const CANVAS_H = MAP_ROWS * TILE_SIZE; // 480
const HUD_SCALE = 2; // HiDPI 2x backing buffer (1536x960) for razor-sharp pixel art + crisp UI text
const SORTED_FURNITURE = getSortedFurniture();
const CHAIR_BY_DESK = new Map<number, FurnitureItem>(
  SORTED_FURNITURE.filter((f) => f.kind === 'chair' && f.deskIndex !== undefined).map((f) => [
    f.deskIndex!,
    f,
  ])
);

const LIGHTING_OPTIONS: Array<{ id: LightingMode; label: string; title: string }> = [
  { id: 'day', label: '☀️ Dia', title: 'Iluminação diurna' },
  { id: 'sunset', label: '🌅 Tarde', title: 'Pôr do sol com luminárias' },
  { id: 'night', label: '🌙 Noite', title: 'Modo noturno com telas e abajures' },
  { id: 'auto', label: '🕒 Auto', title: 'Sincronizar com a hora atual' },
];

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({
  agents,
  meeting,
  selectedAgentId,
  onSelectAgent,
  paused,
  simSpeed,
  onActivitiesUpdate,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const entitiesRef = useRef<Map<string, AgentEntity>>(new Map());
  const particlesRef = useRef<ParticleSystem>(new ParticleSystem());
  const prevActivitiesRef = useRef<Map<string, string>>(new Map());
  const stepParticleCooldownRef = useRef<Map<string, number>>(new Map());

  const agentsRef = useRef<AgentRecord[]>(agents);
  const meetingRef = useRef<MeetingState>(meeting);
  const selectedRef = useRef<string | null>(selectedAgentId);
  const hoveredRef = useRef<string | null>(null);
  const pausedRef = useRef(paused);
  const speedRef = useRef(simSpeed);

  const [hoveredAgentName, setHoveredAgentName] = useState<string | null>(null);
  const [lightingMode, setLightingMode] = useState<LightingMode>('day');
  const lightingModeRef = useRef<LightingMode>(lightingMode);
  const [zoomFocus, setZoomFocus] = useState(false);
  const zoomFocusRef = useRef(zoomFocus);

  // Smooth camera state (center in world pixels + zoom multiplier)
  const camRef = useRef({ x: CANVAS_W / 2, y: CANVAS_H / 2, zoom: 1 });

  agentsRef.current = agents;
  meetingRef.current = meeting;
  selectedRef.current = selectedAgentId;
  pausedRef.current = paused;
  speedRef.current = simSpeed;
  lightingModeRef.current = lightingMode;
  zoomFocusRef.current = zoomFocus;

  useEffect(() => {
    // Dedicated offscreen 1x pixel-art framebuffer (768x480)
    const worldCanvas = document.createElement('canvas');
    worldCanvas.width = CANVAS_W;
    worldCanvas.height = CANVAS_H;
    worldCanvasRef.current = worldCanvas;
    const wctx = worldCanvas.getContext('2d');

    let rafId = 0;
    let lastTime = performance.now();
    let clock = 0;
    let activitySyncTimer = 0;
    let codeParticleTimer = 0;

    const renderFrame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const currentMeeting = meetingRef.current;
      const phase = resolveLightingPhase(lightingModeRef.current);
      const pal = SKY_PALETTES[phase];
      const particles = particlesRef.current;

      if (!pausedRef.current) {
        const scaledDt = dt * speedRef.current;
        clock += scaledDt;
        stepLifeSimulation(
          dt,
          agentsRef.current,
          entitiesRef.current,
          speedRef.current,
          currentMeeting
        );
        particles.update(
          scaledDt,
          phase !== 'night',
          OFFICE_CAT_POS.x,
          OFFICE_CAT_POS.y
        );

        // Emit contextual character particles (footsteps, completion sparkles, coffee steam, work sparks)
        codeParticleTimer += scaledDt;
        const shouldEmitCode = codeParticleTimer >= 0.35;
        if (shouldEmitCode) codeParticleTimer = 0;

        for (const rec of agentsRef.current) {
          const ent = entitiesRef.current.get(rec.id);
          if (!ent) continue;

          const prevAct = prevActivitiesRef.current.get(rec.id);
          if (prevAct === 'working' && ent.activity !== 'working') {
            particles.spawnCompletionBurst(
              ent.x * TILE_SIZE + 16,
              ent.y * TILE_SIZE + 6
            );
          }
          prevActivitiesRef.current.set(rec.id, ent.activity);

          // Footstep dust when rushing
          if (
            ent.activity === 'walking_to_desk' ||
            ent.activity === 'walking_to_meeting'
          ) {
            const cd = (stepParticleCooldownRef.current.get(rec.id) ?? 0) - scaledDt;
            if (cd <= 0) {
              particles.spawnFootstep(ent.x * TILE_SIZE + 16, ent.y * TILE_SIZE + 25);
              stepParticleCooldownRef.current.set(rec.id, 0.22);
            } else {
              stepParticleCooldownRef.current.set(rec.id, cd);
            }
          }

          // Steam from held hot coffee
          if (ent.holdingItem === 'coffee' && Math.random() < scaledDt * 2.2) {
            const hx = ent.dir === 'left' ? ent.x * TILE_SIZE + 8 : ent.x * TILE_SIZE + 26;
            particles.spawnMugSteam(hx, ent.y * TILE_SIZE + 12);
          }

          // Subtle code sparks rising from actively working monitor
          if (shouldEmitCode && rec.status === 'working' && ent.activity === 'working') {
            const slot = DESK_SLOTS[rec.deskIndex % DESK_SLOTS.length];
            if (slot) {
              particles.spawnCodeSpark(
                slot.deskTx * TILE_SIZE + 46,
                slot.deskTy * TILE_SIZE,
                getProviderAccent(rec.provider)
              );
            }
          }
        }
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

      // Smooth camera interpolation (1x full room or 1.45x focus on selected agent / meeting)
      const cam = camRef.current;
      let targetZoom = 1;
      let targetX = CANVAS_W / 2;
      let targetY = CANVAS_H / 2;

      if (zoomFocusRef.current) {
        targetZoom = 1.45;
        const focusId =
          selectedRef.current ||
          (currentMeeting.active ? currentMeeting.currentSpeakerId : undefined);
        const focusEnt = focusId ? entitiesRef.current.get(focusId) : undefined;
        if (focusEnt) {
          targetX = focusEnt.x * TILE_SIZE + 16;
          targetY = focusEnt.y * TILE_SIZE + 12;
        } else if (currentMeeting.active) {
          targetX = 18 * TILE_SIZE;
          targetY = 11 * TILE_SIZE;
        }
      }

      const halfViewW = CANVAS_W / (2 * targetZoom);
      const halfViewH = CANVAS_H / (2 * targetZoom);
      targetX = Math.max(halfViewW, Math.min(CANVAS_W - halfViewW, targetX));
      targetY = Math.max(halfViewH, Math.min(CANVAS_H - halfViewH, targetY));

      const lerp = 1 - Math.exp(-dt * 7);
      cam.zoom += (targetZoom - cam.zoom) * lerp;
      cam.x += (targetX - cam.x) * lerp;
      cam.y += (targetY - cam.y) * lerp;

      // === PASS 1: Render 16-bit Pixel-Art World onto 1x offscreen canvas ===
      if (wctx) {
        wctx.imageSmoothingEnabled = false;
        wctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        drawOfficeFloorAndWalls(wctx, clock, phase);

        // Meeting active subtle floor border on lounge rug
        if (currentMeeting.active) {
          wctx.save();
          const pulse = 0.35 + Math.sin(clock * 3.2) * 0.14;
          wctx.strokeStyle = `rgba(196, 181, 253, ${pulse + 0.35})`;
          wctx.fillStyle = `rgba(139, 92, 246, ${pulse * 0.18})`;
          wctx.lineWidth = 2;
          wctx.fillRect(
            15 * TILE_SIZE + 4,
            8 * TILE_SIZE + 4,
            8 * TILE_SIZE - 8,
            6 * TILE_SIZE - 8
          );
          wctx.strokeRect(
            15 * TILE_SIZE + 4,
            8 * TILE_SIZE + 4,
            8 * TILE_SIZE - 8,
            6 * TILE_SIZE - 8
          );
          wctx.restore();
        }

        const meetingParticipantSet = new Set(
          currentMeeting.active ? currentMeeting.participantIds : []
        );
        const meetingSpeakerId =
          currentMeeting.active && currentMeeting.status === 'running'
            ? currentMeeting.currentSpeakerId
            : undefined;

        // Collect desk visual states (provider accent + working state)
        const deskInfoByIndex = new Map<number, DeskVisualInfo>();
        const workingDeskGlows = new Map<number, string>();
        let anyAgentWorking = false;

        for (const rec of agentsRef.current) {
          const ent = entitiesRef.current.get(rec.id);
          const idx = rec.deskIndex % DESK_SLOTS.length;
          const accent = getProviderAccent(rec.provider);
          const isDeskWorking = rec.status === 'working' && ent?.activity === 'working';
          if (rec.status === 'working') anyAgentWorking = true;
          if (!deskInfoByIndex.has(idx) || isDeskWorking) {
            deskInfoByIndex.set(idx, { working: isDeskWorking, accentColor: accent });
          }
          if (isDeskWorking) {
            workingDeskGlows.set(idx, accent);
          }
        }

        // Depth-sorted draw list (wall decor, furniture, sleeping cat, characters, chair backrests)
        type Drawable = { ySort: number; draw: () => void };
        const drawables: Drawable[] = [];

        for (const item of SORTED_FURNITURE) {
          const isWallDecor =
            item.kind === 'wall_clock' ||
            item.kind === 'wall_poster' ||
            item.kind === 'corkboard' ||
            item.kind === 'whiteboard';
          const ySort = isWallDecor
            ? 0.5
            : item.kind === 'chair'
              ? item.ty - 0.15
              : item.ty + item.h - 0.1;
          drawables.push({
            ySort,
            draw: () =>
              drawFurnitureItem(
                wctx,
                item,
                clock,
                deskInfoByIndex,
                pal.lampsOn,
                anyAgentWorking
              ),
          });
        }

        // Ambient office cat on the lounge rug
        drawables.push({
          ySort: OFFICE_CAT_POS.y / TILE_SIZE + 0.1,
          draw: () => drawOfficeCat(wctx, clock),
        });

        // Characters + split chair backrest overlay when seated at desk
        for (const rec of agentsRef.current) {
          const ent = entitiesRef.current.get(rec.id);
          if (!ent) continue;
          const isParticipant = meetingParticipantSet.has(rec.id);
          const isSpeaker = meetingSpeakerId === rec.id;
          const isSeatedAtDesk =
            (ent.activity === 'working' || ent.activity === 'idle_desk') &&
            ent.dir === 'up';
          const deskIdx = rec.deskIndex % DESK_SLOTS.length;
          const chairItem = isSeatedAtDesk ? CHAIR_BY_DESK.get(deskIdx) : undefined;

          drawables.push({
            ySort: ent.y + 0.5,
            draw: () => {
              drawAgentCharacter(
                wctx,
                rec,
                ent,
                selectedRef.current === rec.id,
                hoveredRef.current === rec.id,
                clock,
                isParticipant,
                isSpeaker
              );
              if (chairItem) {
                drawChairBackrest(wctx, chairItem);
              }
            },
          });
        }

        drawables.sort((a, b) => a.ySort - b.ySort);
        for (const d of drawables) d.draw();

        // Pixel particles (steam, dust motes, sparks, footsteps, cat Zzz)
        particles.draw(wctx);

        // Dynamic lighting layer (ambient tint, sun/moon shafts, lamps, glowing screens)
        drawLightingOverlay(
          wctx,
          phase,
          clock,
          workingDeskGlows,
          currentMeeting.active,
          currentMeeting.status === 'running'
        );
      }

      // === PASS 2: Blit Pixel-Art World crisply onto 2x HiDPI Display Canvas + Crisp HUD ===
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const outW = CANVAS_W * HUD_SCALE;
          const outH = CANVAS_H * HUD_SCALE;
          ctx.clearRect(0, 0, outW, outH);

          ctx.save();
          // Apply camera transform
          ctx.translate(outW / 2, outH / 2);
          ctx.scale(cam.zoom, cam.zoom);
          ctx.translate(-cam.x * HUD_SCALE, -cam.y * HUD_SCALE);

          // Crisp nearest-neighbor upscale of the 16-bit pixel art world!
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(worldCanvas, 0, 0, outW, outH);

          // Enable smooth rendering ONLY for crisp HiDPI text, badges & speech bubbles
          ctx.imageSmoothingEnabled = true;

          // Meeting room crisp badge label
          if (currentMeeting.active) {
            ctx.save();
            const label =
              currentMeeting.status === 'running'
                ? '● REUNIÃO AO VIVO'
                : '● SALA DE REUNIÃO';
            ctx.font = `700 ${9 * HUD_SCALE}px Inter, system-ui, sans-serif`;
            const tw = ctx.measureText(label).width;
            const lx = (15 * TILE_SIZE + 8) * HUD_SCALE;
            const ly = (8 * TILE_SIZE + 8) * HUD_SCALE;
            ctx.fillStyle = 'rgba(46, 16, 101, 0.88)';
            ctx.beginPath();
            ctx.roundRect(lx, ly, tw + 10 * HUD_SCALE, 14 * HUD_SCALE, 4 * HUD_SCALE);
            ctx.fill();
            ctx.fillStyle = '#ede9fe';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, lx + 5 * HUD_SCALE, ly + 7 * HUD_SCALE);
            ctx.restore();
          }

          const meetingSpeakerId =
            currentMeeting.active && currentMeeting.status === 'running'
              ? currentMeeting.currentSpeakerId
              : undefined;

          // Crisp HiDPI name badges
          for (const rec of agentsRef.current) {
            const ent = entitiesRef.current.get(rec.id);
            if (!ent) continue;
            drawAgentBadgeHiDPI(
              ctx,
              rec,
              ent,
              selectedRef.current === rec.id,
              hoveredRef.current === rec.id,
              HUD_SCALE
            );
          }

          // Crisp HiDPI speech / status bubbles with overlap avoidance
          const bubbleItems: Array<{
            agent: AgentRecord;
            entity: AgentEntity;
            isMeetingSpeaker: boolean;
          }> = [];
          for (const rec of agentsRef.current) {
            const ent = entitiesRef.current.get(rec.id);
            if (!ent) continue;
            bubbleItems.push({
              agent: rec,
              entity: ent,
              isMeetingSpeaker: meetingSpeakerId === rec.id,
            });
          }
          drawAgentBubblesHiDPI(ctx, bubbleItems, HUD_SCALE);

          ctx.restore();
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
    const nx = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const ny = ((e.clientY - rect.top) / rect.height) * CANVAS_H;

    // Invert camera zoom/pan to world pixel coordinates
    const cam = camRef.current;
    const mx = (nx - CANVAS_W / 2) / cam.zoom + cam.x;
    const my = (ny - CANVAS_H / 2) / cam.zoom + cam.y;

    for (const rec of agentsRef.current) {
      const ent = entitiesRef.current.get(rec.id);
      if (!ent) continue;
      const ax = ent.x * TILE_SIZE;
      const ay = ent.y * TILE_SIZE;
      if (
        mx >= ax - 4 &&
        mx <= ax + TILE_SIZE + 4 &&
        my >= ay - 6 &&
        my <= ay + TILE_SIZE + 12
      ) {
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
          width={CANVAS_W * HUD_SCALE}
          height={CANVAS_H * HUD_SCALE}
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

      <div className="office-stage-bar">
        <div className="lighting-switcher" role="group" aria-label="Iluminação do escritório">
          {LIGHTING_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`stage-chip-btn ${lightingMode === opt.id ? 'active' : ''}`}
              onClick={() => setLightingMode(opt.id)}
              title={opt.title}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            className={`stage-chip-btn ${zoomFocus ? 'active' : ''}`}
            onClick={() => setZoomFocus((z) => !z)}
            title="Alternar zoom cinematográfico no agente selecionado"
          >
            {zoomFocus ? '🔍 1.4x' : '🔍 1x'}
          </button>
        </div>

        <div className="office-legend">
          <span>☕ Café</span>
          <span>💧 Bebedouro</span>
          <span>🌤️ Janelas</span>
          <span>🐱 Gato</span>
          <span>💻 Clique em um personagem para interagir</span>
        </div>
      </div>
    </div>
  );
};

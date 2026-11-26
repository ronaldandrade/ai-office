import React, { useEffect, useRef } from 'react';
import { drawAgentPortrait, PORTRAIT_SIZE } from '../engine/pixelSprites.ts';
import type { AgentRecord } from '../types/office.ts';

interface AgentAvatarProps {
  agent: Pick<AgentRecord, 'id' | 'name' | 'provider' | 'appearance' | 'status'>;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showStatusDot?: boolean;
}

export const AgentAvatar: React.FC<AgentAvatarProps> = ({
  agent,
  size = 'md',
  showStatusDot = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const { hairColor, skinColor, shirtColor, pantsColor, accessory } = agent.appearance;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    drawAgentPortrait(ctx, {
      id: agent.id,
      name: agent.name,
      provider: agent.provider,
      appearance: { hairColor, skinColor, shirtColor, pantsColor, accessory },
    });
  }, [
    agent.id,
    agent.name,
    agent.provider,
    hairColor,
    skinColor,
    shirtColor,
    pantsColor,
    accessory,
  ]);

  return (
    <div
      className={`pixel-avatar-frame size-${size} status-${agent.status}`}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        width={PORTRAIT_SIZE}
        height={PORTRAIT_SIZE}
        className="pixel-avatar-canvas"
      />
      {showStatusDot && <span className={`status-dot ${agent.status}`} />}
    </div>
  );
};

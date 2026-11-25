import type {
  AgentEntity,
  AgentRecord,
  Direction,
  LifeActivity,
  MeetingState,
} from '../types/office.ts';
import { DESK_SLOTS, MEETING_SPOTS, POINTS_OF_INTEREST } from './officeMap.ts';
import { findPath } from './pathfinding.ts';

const COFFEE_QUOTES = [
  '☕ Café passado na hora!',
  '☕ Mais um espresso...',
  '☕ Energia recarregada!',
  '☕ Nada como um cafézinho.',
];

const WATER_QUOTES = [
  '💧 Hora de hidratar!',
  '💧 Água geladinha.',
  '💧 Saúde em primeiro lugar!',
];

const WINDOW_QUOTES = [
  '🌤️ Que vista boa lá fora...',
  '☁️ Pensando na arquitetura...',
  '🐦 Olha um passarinho!',
  '🌤️ Respirando um pouco...',
];

const WHITEBOARD_QUOTES = [
  '📊 Esse fluxo faz sentido...',
  '✏️ Anotando uma ideia...',
  '🧩 Conectando os pontos...',
];

const SOFA_QUOTES = [
  '🛋️ Pausa merecida.',
  '😌 Relaxando 2 minutinhos...',
  '🎵 Curtindo o silêncio...',
];

const PLANT_QUOTES = [
  '🌿 Essa folha cresceu!',
  '🪴 Cuidando da plantinha...',
];

const CHAT_SCRIPTS: Array<[string, string, string, string]> = [
  [
    'E aí, viu o último commit?',
    'Vi sim! Ficou limpinho demais.',
    'Depois bora revisar os testes?',
    'Fechado! Só terminar meu café.',
  ],
  [
    'Já tomou quantos cafés hoje?',
    'Acho que já perdi a conta 😅',
    'Clássico dia de escritório!',
    'Total haha, mas rende bem!',
  ],
  [
    'Se chegar tarefa nova eu pego!',
    'Beleza, eu ajudo na revisão.',
    'Time sincronizado é outro nível.',
    'Com certeza! 🚀',
  ],
  [
    'Que tal refatorar aquele módulo?',
    'Boa ideia, deixa tudo mais leve.',
    'Quando o chefe pedir, a gente manda ver!',
    'Tô pronto!',
  ],
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function createInitialEntity(agent: AgentRecord): AgentEntity {
  const desk = DESK_SLOTS[agent.deskIndex % DESK_SLOTS.length];
  return {
    id: agent.id,
    x: desk.seatTx,
    y: desk.seatTy,
    dir: desk.facing,
    path: [],
    activity: agent.status === 'working' ? 'working' : 'idle_desk',
    targetActivity: agent.status === 'working' ? 'working' : 'idle_desk',
    stateTimer: randRange(1.5, 5.0),
    animTimer: Math.random() * 10,
    bubbleTimer: 0,
    chatLineIndex: 0,
    chatScriptIndex: 0,
    holdingItem: null,
  };
}

function getPoiActivity(kind: string): LifeActivity {
  switch (kind) {
    case 'coffee':
      return 'drinking_coffee';
    case 'water':
      return 'drinking_water';
    case 'window':
      return 'looking_window';
    case 'whiteboard':
      return 'reading_whiteboard';
    case 'sofa':
      return 'relaxing_sofa';
    case 'plant':
      return 'admiring_plant';
    default:
      return 'chatting';
  }
}

function getQuoteForActivity(activity: LifeActivity): string | undefined {
  switch (activity) {
    case 'drinking_coffee':
      return pickRandom(COFFEE_QUOTES);
    case 'drinking_water':
      return pickRandom(WATER_QUOTES);
    case 'looking_window':
      return pickRandom(WINDOW_QUOTES);
    case 'reading_whiteboard':
      return pickRandom(WHITEBOARD_QUOTES);
    case 'relaxing_sofa':
      return pickRandom(SOFA_QUOTES);
    case 'admiring_plant':
      return pickRandom(PLANT_QUOTES);
    default:
      return undefined;
  }
}

function isEntityFreeForChat(entity: AgentEntity, record?: AgentRecord): boolean {
  if (!record || record.status === 'working') return false;
  if (entity.chatPartnerId) return false;
  return (
    entity.activity !== 'working' &&
    entity.activity !== 'walking_to_desk' &&
    entity.activity !== 'walking_to_meeting' &&
    entity.activity !== 'in_meeting' &&
    entity.activity !== 'chatting'
  );
}

function chooseNextIdleBehavior(
  entity: AgentEntity,
  record: AgentRecord,
  allEntities: Map<string, AgentEntity>,
  recordsById: Map<string, AgentRecord>
): void {
  const occupiedPois = new Set<string>();
  for (const other of allEntities.values()) {
    if (other.id !== entity.id && other.targetPoiId) {
      occupiedPois.add(other.targetPoiId);
    }
  }

  // 28% chance to invite another idle agent for a chat!
  if (Math.random() < 0.28) {
    const candidates = Array.from(allEntities.values()).filter(
      (other) =>
        other.id !== entity.id &&
        isEntityFreeForChat(other, recordsById.get(other.id))
    );
    const chatPois = POINTS_OF_INTEREST.filter(
      (p) => p.kind === 'chat' && p.partnerSpot && !occupiedPois.has(p.id)
    );

    if (candidates.length > 0 && chatPois.length > 0) {
      const partner = pickRandom(candidates);
      const poi = pickRandom(chatPois);
      const scriptIdx = Math.floor(Math.random() * CHAT_SCRIPTS.length);

      const pathA = findPath(entity.x, entity.y, poi.tx, poi.ty);
      const pathB = findPath(
        partner.x,
        partner.y,
        poi.partnerSpot!.tx,
        poi.partnerSpot!.ty
      );

      if (pathA.length > 0 || (Math.round(entity.x) === poi.tx && Math.round(entity.y) === poi.ty)) {
        entity.activity = 'walking_to_poi';
        entity.targetActivity = 'chatting';
        entity.targetPoiId = poi.id;
        entity.targetFacing = poi.facing;
        entity.path = pathA;
        entity.chatPartnerId = partner.id;
        entity.chatLineIndex = 0;
        entity.chatScriptIndex = scriptIdx;
        entity.holdingItem = null;
        entity.bubbleText = `💬 Oi ${recordsById.get(partner.id)?.name ?? ''}!`;
        entity.bubbleTimer = 2.2;

        partner.activity = 'walking_to_poi';
        partner.targetActivity = 'chatting';
        partner.targetPoiId = poi.id;
        partner.targetFacing = poi.partnerSpot!.facing;
        partner.path = pathB;
        partner.chatPartnerId = entity.id;
        partner.chatLineIndex = 0;
        partner.chatScriptIndex = scriptIdx;
        partner.holdingItem = null;
        partner.bubbleText = '💬 Já tô indo!';
        partner.bubbleTimer = 2.0;
        return;
      }
    }
  }

  // 15% chance to sit briefly at desk
  if (Math.random() < 0.15 && entity.activity !== 'idle_desk') {
    const desk = DESK_SLOTS[record.deskIndex % DESK_SLOTS.length];
    entity.activity = 'walking_to_poi';
    entity.targetActivity = 'idle_desk';
    entity.targetPoiId = undefined;
    entity.targetFacing = desk.facing;
    entity.path = findPath(entity.x, entity.y, desk.seatTx, desk.seatTy);
    entity.holdingItem = null;
    return;
  }

  // Otherwise pick an available POI (coffee, water, window, sofa, whiteboard, plant)
  const availablePois = POINTS_OF_INTEREST.filter(
    (p) => p.kind !== 'chat' && !occupiedPois.has(p.id) && p.id !== entity.targetPoiId
  );
  if (availablePois.length === 0) {
    entity.stateTimer = randRange(3, 6);
    return;
  }

  const chosen = pickRandom(availablePois);
  const path = findPath(entity.x, entity.y, chosen.tx, chosen.ty);
  entity.activity = 'walking_to_poi';
  entity.targetActivity = getPoiActivity(chosen.kind);
  entity.targetPoiId = chosen.id;
  entity.targetFacing = chosen.facing;
  entity.path = path;
  entity.holdingItem = null;
}

function clearChatPartner(
  entity: AgentEntity,
  allEntities: Map<string, AgentEntity>
): void {
  if (!entity.chatPartnerId) return;
  const partner = allEntities.get(entity.chatPartnerId);
  if (partner && partner.chatPartnerId === entity.id) {
    partner.chatPartnerId = undefined;
    if (partner.activity === 'chatting') {
      partner.stateTimer = Math.min(partner.stateTimer, 0.8);
    }
  }
  entity.chatPartnerId = undefined;
}

export function stepLifeSimulation(
  dt: number,
  records: AgentRecord[],
  entities: Map<string, AgentEntity>,
  speedMultiplier = 1,
  meeting?: MeetingState
): void {
  const scaledDt = Math.min(dt, 0.1) * speedMultiplier;
  const recordsById = new Map(records.map((r) => [r.id, r]));
  const meetingActive = Boolean(meeting?.active);
  const meetingSpotByAgent = new Map<string, number>();
  if (meetingActive && meeting) {
    meeting.participantIds.forEach((id, idx) => {
      meetingSpotByAgent.set(id, idx);
    });
  }

  // Sync added/removed agents
  for (const rec of records) {
    if (!entities.has(rec.id)) {
      entities.set(rec.id, createInitialEntity(rec));
    }
  }
  for (const id of Array.from(entities.keys())) {
    if (!recordsById.has(id)) {
      const ent = entities.get(id)!;
      clearChatPartner(ent, entities);
      entities.delete(id);
    }
  }

  for (const rec of records) {
    const entity = entities.get(rec.id)!;
    entity.animTimer += scaledDt;
    if (entity.bubbleTimer > 0) {
      entity.bubbleTimer = Math.max(0, entity.bubbleTimer - scaledDt);
      if (entity.bubbleTimer === 0) entity.bubbleText = undefined;
    }

    const desk = DESK_SLOTS[rec.deskIndex % DESK_SLOTS.length];
    const meetingSlotIdx = meetingSpotByAgent.get(rec.id);
    const isInActiveMeeting = meetingActive && meetingSlotIdx !== undefined;

    if (isInActiveMeeting) {
      const spot = MEETING_SPOTS[meetingSlotIdx % MEETING_SPOTS.length];
      const distToSpot = Math.hypot(entity.x - spot.tx, entity.y - spot.ty);

      if (entity.activity !== 'walking_to_meeting' && entity.activity !== 'in_meeting') {
        clearChatPartner(entity, entities);
        entity.targetPoiId = undefined;
        entity.holdingItem = null;
        if (distToSpot < 0.15) {
          entity.x = spot.tx;
          entity.y = spot.ty;
          entity.dir = spot.facing;
          entity.activity = 'in_meeting';
          entity.targetActivity = 'in_meeting';
          entity.path = [];
        } else {
          entity.activity = 'walking_to_meeting';
          entity.targetActivity = 'in_meeting';
          entity.targetFacing = spot.facing;
          entity.path = findPath(entity.x, entity.y, spot.tx, spot.ty);
          entity.bubbleText = '📣 Indo para a reunião!';
          entity.bubbleTimer = 2.4;
        }
      } else if (entity.activity === 'in_meeting' && distToSpot >= 0.25) {
        // Re-route if participant spot index shifted
        entity.activity = 'walking_to_meeting';
        entity.targetActivity = 'in_meeting';
        entity.targetFacing = spot.facing;
        entity.path = findPath(entity.x, entity.y, spot.tx, spot.ty);
      } else if (entity.activity === 'walking_to_meeting') {
        const dest = entity.path[entity.path.length - 1];
        if (dest && (dest.tx !== spot.tx || dest.ty !== spot.ty)) {
          entity.targetFacing = spot.facing;
          entity.path = findPath(entity.x, entity.y, spot.tx, spot.ty);
        }
      }
    } else if (entity.activity === 'in_meeting' || entity.activity === 'walking_to_meeting') {
      entity.activity = 'idle_desk';
      entity.targetActivity = 'idle_desk';
      entity.path = [];
      entity.stateTimer = randRange(1.0, 2.5);
      entity.bubbleText = '👋 Reunião encerrada!';
      entity.bubbleTimer = 2.4;
    }

    // Transition to working immediately when backend says working (unless in active meeting)
    if (!isInActiveMeeting) {
      if (rec.status === 'working') {
        if (entity.activity !== 'working' && entity.activity !== 'walking_to_desk') {
          clearChatPartner(entity, entities);
          entity.targetPoiId = undefined;
          entity.holdingItem = null;
          const distToDesk = Math.hypot(entity.x - desk.seatTx, entity.y - desk.seatTy);
          if (distToDesk < 0.15) {
            entity.x = desk.seatTx;
            entity.y = desk.seatTy;
            entity.dir = desk.facing;
            entity.activity = 'working';
            entity.path = [];
          } else {
            entity.activity = 'walking_to_desk';
            entity.targetActivity = 'working';
            entity.targetFacing = desk.facing;
            entity.path = findPath(entity.x, entity.y, desk.seatTx, desk.seatTy);
            entity.bubbleText = '⚡ Indo para a mesa!';
            entity.bubbleTimer = 2.4;
          }
        }
      } else if (entity.activity === 'working' || entity.activity === 'walking_to_desk') {
        // Finished work! Take a short breath at desk then live life
        entity.activity = 'idle_desk';
        entity.targetActivity = 'idle_desk';
        entity.stateTimer = randRange(2.0, 4.5);
        entity.bubbleText = '✅ Concluído!';
        entity.bubbleTimer = 2.6;
      }
    }

    // Movement along A* path
    if (
      (entity.activity === 'walking_to_desk' ||
        entity.activity === 'walking_to_poi' ||
        entity.activity === 'walking_to_meeting') &&
      entity.path.length > 0
    ) {
      const speed =
        entity.activity === 'walking_to_desk' || entity.activity === 'walking_to_meeting'
          ? 4.0
          : 2.3;
      const next = entity.path[0];
      const dx = next.tx - entity.x;
      const dy = next.ty - entity.y;
      const dist = Math.hypot(dx, dy);

      if (Math.abs(dx) > Math.abs(dy)) {
        entity.dir = dx > 0 ? 'right' : 'left';
      } else if (Math.abs(dy) > 0.001) {
        entity.dir = dy > 0 ? 'down' : 'up';
      }

      const step = speed * scaledDt;
      if (dist <= step) {
        entity.x = next.tx;
        entity.y = next.ty;
        entity.path.shift();
      } else {
        entity.x += (dx / dist) * step;
        entity.y += (dy / dist) * step;
      }
      continue;
    }

    // Arrived at destination
    if (entity.activity === 'walking_to_desk') {
      entity.x = desk.seatTx;
      entity.y = desk.seatTy;
      entity.dir = desk.facing;
      entity.activity = 'working';
      continue;
    }

    if (entity.activity === 'walking_to_meeting' && isInActiveMeeting) {
      const spot = MEETING_SPOTS[meetingSlotIdx! % MEETING_SPOTS.length];
      entity.x = spot.tx;
      entity.y = spot.ty;
      entity.dir = spot.facing;
      entity.activity = 'in_meeting';
      continue;
    }

    if (entity.activity === 'in_meeting') {
      if (isInActiveMeeting) {
        const spot = MEETING_SPOTS[meetingSlotIdx! % MEETING_SPOTS.length];
        entity.dir = spot.facing;
      }
      continue;
    }

    if (entity.activity === 'walking_to_poi') {
      entity.activity = entity.targetActivity;
      if (entity.targetFacing) entity.dir = entity.targetFacing;
      entity.stateTimer =
        entity.activity === 'chatting' ? randRange(9, 13) : randRange(5, 10);

      if (entity.activity === 'drinking_coffee') entity.holdingItem = 'coffee';
      else if (entity.activity === 'drinking_water') entity.holdingItem = 'water';
      else entity.holdingItem = null;

      const quote = getQuoteForActivity(entity.activity);
      if (quote) {
        entity.bubbleText = quote;
        entity.bubbleTimer = 3.6;
      }
      continue;
    }

    // Active working state: show current backend tool/activity
    if (entity.activity === 'working') {
      entity.dir = desk.facing;
      continue;
    }

    // Chatting state: alternate dialogue bubbles with partner
    if (entity.activity === 'chatting') {
      entity.stateTimer -= scaledDt;
      const partner = entity.chatPartnerId
        ? entities.get(entity.chatPartnerId)
        : undefined;

      if (!partner || partner.activity === 'working' || partner.activity === 'walking_to_desk') {
        clearChatPartner(entity, entities);
        entity.stateTimer = 0.5;
      } else if (partner.activity === 'chatting') {
        // Turn towards partner
        const dx = partner.x - entity.x;
        const dy = partner.y - entity.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          entity.dir = dx >= 0 ? 'right' : 'left';
        } else {
          entity.dir = dy >= 0 ? 'down' : 'up';
        }

        // Only the lower-ID agent drives the conversation timing
        if (entity.id < partner.id && entity.bubbleTimer <= 0 && partner.bubbleTimer <= 0) {
          const script = CHAT_SCRIPTS[entity.chatScriptIndex % CHAT_SCRIPTS.length];
          const lineIdx = entity.chatLineIndex % script.length;
          const speaker = lineIdx % 2 === 0 ? entity : partner;
          speaker.bubbleText = script[lineIdx];
          speaker.bubbleTimer = 2.6;
          entity.chatLineIndex++;
        }
      }

      if (entity.stateTimer <= 0) {
        clearChatPartner(entity, entities);
        entity.targetPoiId = undefined;
        chooseNextIdleBehavior(entity, rec, entities, recordsById);
      }
      continue;
    }

    // Any other idle activity: count down timer, then pick next activity
    entity.stateTimer -= scaledDt;
    if (entity.stateTimer <= 0) {
      entity.holdingItem = null;
      chooseNextIdleBehavior(entity, rec, entities, recordsById);
    }
  }
}

export function getActivityLabel(entity: AgentEntity, record: AgentRecord): string {
  if (record.status === 'working') {
    return record.currentActivity || 'Trabalhando na mesa...';
  }
  switch (entity.activity) {
    case 'drinking_coffee':
      return 'Tomando café ☕';
    case 'drinking_water':
      return 'Bebendo água 💧';
    case 'looking_window':
      return 'Olhando pela janela 🌤️';
    case 'chatting':
      return 'Conversando no escritório 💬';
    case 'reading_whiteboard':
      return 'Analisando o quadro branco 📊';
    case 'relaxing_sofa':
      return 'Descansando no lounge 🛋️';
    case 'admiring_plant':
      return 'Cuidando das plantas 🌿';
    case 'walking_to_desk':
      return 'Indo para a mesa ⚡';
    case 'walking_to_meeting':
      return 'Indo para a reunião 📣';
    case 'in_meeting':
      return 'Na reunião 👥';
    case 'walking_to_poi':
      return 'Caminhando pelo escritório 🚶';
    default:
      return 'Disponível na mesa';
  }
}

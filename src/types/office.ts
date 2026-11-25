export type {
  AgentAppearance,
  AgentRecord,
  AgentSummary,
  ChatMessage,
  CliProviderInfo,
  MeetingMessage,
  MeetingState,
  OfficeStateSnapshot,
  ProviderId,
  WsClientMessage,
  WsServerMessage,
} from '../../server/types.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type LifeActivity =
  | 'idle_desk'
  | 'working'
  | 'walking_to_desk'
  | 'walking_to_poi'
  | 'walking_to_meeting'
  | 'in_meeting'
  | 'drinking_coffee'
  | 'drinking_water'
  | 'looking_window'
  | 'chatting'
  | 'reading_whiteboard'
  | 'relaxing_sofa'
  | 'admiring_plant';

export interface TilePoint {
  tx: number;
  ty: number;
}

export interface AgentEntity {
  id: string;
  x: number; // tile units (float)
  y: number; // tile units (float)
  dir: Direction;
  path: TilePoint[];
  activity: LifeActivity;
  targetActivity: LifeActivity;
  targetPoiId?: string;
  targetFacing?: Direction;
  stateTimer: number; // seconds remaining in current idle state
  animTimer: number;
  bubbleText?: string;
  bubbleTimer: number;
  chatPartnerId?: string;
  chatLineIndex: number;
  chatScriptIndex: number;
  holdingItem?: 'coffee' | 'water' | null;
}

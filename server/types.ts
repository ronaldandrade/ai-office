export type ProviderId =
  | 'claude'
  | 'gemini'
  | 'codex'
  | 'agy'
  | 'aider'
  | 'custom'
  | 'demo';

export interface CliProviderInfo {
  id: ProviderId;
  name: string;
  binary: string;
  installed: boolean;
  resolvedPath?: string;
  description: string;
  defaultArgsTemplate: string;
  accentColor: string;
}

export interface AgentAppearance {
  hairColor: string;
  skinColor: string;
  shirtColor: string;
  pantsColor: string;
  accessory?: 'glasses' | 'headphones' | 'cap' | 'none';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'streaming' | 'done' | 'error' | 'aborted';
  toolActivity?: string;
}

export interface AgentSummary {
  summary: string;
  lastPrompt?: string;
  timestamp: number;
  source: string;
  toolsUsed: string[];
  sessionFile?: string;
}

export interface AgentRecord {
  id: string;
  name: string;
  roleTitle: string;
  provider: ProviderId;
  origin: 'terminal' | 'manual';
  terminalPid?: number;
  customCommand?: string;
  cwd: string;
  deskIndex: number;
  appearance: AgentAppearance;
  status: 'idle' | 'working' | 'error';
  currentActivity?: string;
  lastSummary?: AgentSummary | null;
  messages: ChatMessage[];
}

export interface MeetingMessage {
  id: string;
  senderType: 'user' | 'agent' | 'system';
  senderId?: string;
  senderName: string;
  senderRole?: string;
  senderColor?: string;
  content: string;
  timestamp: number;
  status?: 'streaming' | 'done' | 'error' | 'aborted';
  toolActivity?: string;
  round?: number;
}

export interface MeetingState {
  active: boolean;
  topic: string;
  participantIds: string[];
  cwd: string;
  status: 'idle' | 'running';
  currentSpeakerId?: string;
  currentRound: number;
  maxRounds: number;
  messages: MeetingMessage[];
}

export interface OfficeStateSnapshot {
  defaultCwd: string;
  providers: CliProviderInfo[];
  agents: AgentRecord[];
  meeting: MeetingState;
}

export type WsClientMessage =
  | { type: 'run_task'; agentId: string; prompt: string; cwd?: string }
  | { type: 'abort_task'; agentId: string }
  | { type: 'clear_history'; agentId: string }
  | { type: 'refresh_providers' }
  | { type: 'set_default_cwd'; cwd: string }
  | {
      type: 'create_agent';
      agent: Omit<AgentRecord, 'id' | 'status' | 'messages' | 'deskIndex' | 'origin'> & {
        deskIndex?: number;
      };
    }
  | {
      type: 'update_agent';
      agentId: string;
      patch: Partial<
        Pick<
          AgentRecord,
          'name' | 'roleTitle' | 'provider' | 'customCommand' | 'cwd' | 'appearance'
        >
      >;
    }
  | { type: 'delete_agent'; agentId: string }
  | {
      type: 'start_meeting';
      participantIds: string[];
      topic?: string;
      cwd?: string;
      maxRounds?: number;
    }
  | {
      type: 'update_meeting';
      participantIds?: string[];
      topic?: string;
      cwd?: string;
      maxRounds?: number;
    }
  | {
      type: 'send_meeting_message';
      content: string;
      rounds?: number;
    }
  | { type: 'abort_meeting' }
  | { type: 'clear_meeting_history' }
  | { type: 'end_meeting' };

export type WsServerMessage =
  | { type: 'snapshot'; data: OfficeStateSnapshot }
  | {
      type: 'agent_status';
      agentId: string;
      status: AgentRecord['status'];
      currentActivity?: string;
    }
  | { type: 'message_added'; agentId: string; message: ChatMessage }
  | {
      type: 'message_chunk';
      agentId: string;
      messageId: string;
      chunk: string;
      toolActivity?: string;
    }
  | {
      type: 'message_done';
      agentId: string;
      messageId: string;
      status: 'done' | 'error' | 'aborted';
      finalContent?: string;
    }
  | { type: 'meeting_updated'; meeting: MeetingState }
  | { type: 'meeting_message_added'; message: MeetingMessage }
  | {
      type: 'meeting_message_chunk';
      messageId: string;
      chunk: string;
      toolActivity?: string;
    }
  | {
      type: 'meeting_message_done';
      messageId: string;
      status: 'done' | 'error' | 'aborted';
      finalContent?: string;
    }
  | { type: 'providers_updated'; providers: CliProviderInfo[] }
  | { type: 'error'; message: string };

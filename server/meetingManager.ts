import type { AgentRunner } from './agentRunner.ts';
import {
  parseMeetingMessageContent,
  parseMeetingParticipantIds,
  parseMeetingRounds,
  parseMeetingTopic,
  validateWorkspacePath,
} from './security.ts';
import type {
  AgentRecord,
  CliProviderInfo,
  MeetingMessage,
  MeetingState,
  WsServerMessage,
} from './types.ts';

const MAX_MEETING_MESSAGES = 120;
const MAX_TRANSCRIPT_CHARS = 10_000;
const TURN_GAP_MS = 220;

interface TurnEntry {
  agentId: string;
  round: number;
}

export interface MeetingManagerDeps {
  getAgents: () => AgentRecord[];
  getProviders: () => CliProviderInfo[];
  getDefaultCwd: () => string;
  runner: Pick<AgentRunner, 'run' | 'abort' | 'isRunning'>;
  broadcast: (msg: WsServerMessage) => void;
  turnGapMs?: number;
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Resolves which participants should reply to a user message.
 * If the message contains @mentions matching one or more participants,
 * only those mentioned participants respond (in meeting order).
 * Otherwise, all participants respond in order.
 */
export function resolveTargetParticipants(
  content: string,
  participants: AgentRecord[]
): AgentRecord[] {
  const mentionMatches = [...content.matchAll(/@([^\s,;:.!?()[\]{}"'`]+)/g)];
  if (mentionMatches.length === 0) {
    return participants;
  }

  const normalizedMentions = mentionMatches.map((m) => normalizeForMatch(m[1]));
  const matched = participants.filter((agent) => {
    const fullNorm = normalizeForMatch(agent.name);
    const firstWord = fullNorm.split(/\s+/)[0] || fullNorm;
    return normalizedMentions.some(
      (mention) =>
        mention === fullNorm ||
        mention === firstWord ||
        (mention.length >= 2 && fullNorm.startsWith(mention))
    );
  });

  return matched.length > 0 ? matched : participants;
}

/**
 * Builds the collaborative prompt sent to the current speaker,
 * including recent messages from the user and other agents so
 * each agent genuinely reads and responds to their colleagues.
 */
export function buildMeetingPrompt(
  speaker: AgentRecord,
  participants: AgentRecord[],
  state: MeetingState,
  round: number,
  totalRounds: number
): string {
  const participantList = participants
    .map((p) => `- ${p.name} (${p.roleTitle})${p.id === speaker.id ? ' [VOCÊ]' : ''}`)
    .join('\n');

  // Collect completed/non-empty messages (skip system notices and the current empty streaming message)
  const historyEntries = state.messages
    .filter((m) => m.senderType !== 'system' && m.content.trim().length > 0)
    .map((m) => {
      const label =
        m.senderType === 'user'
          ? 'Você'
          : m.senderRole
            ? `${m.senderName} (${m.senderRole})`
            : m.senderName;
      return `[${label}]: ${m.content.trim()}`;
    });

  // Keep the most recent entries within MAX_TRANSCRIPT_CHARS
  const selectedLines: string[] = [];
  let charBudget = MAX_TRANSCRIPT_CHARS;
  for (let i = historyEntries.length - 1; i >= 0; i--) {
    const entry = historyEntries[i];
    if (selectedLines.length > 0 && entry.length + 2 > charBudget) {
      break;
    }
    const clipped =
      entry.length > charBudget
        ? `${entry.slice(0, Math.max(0, charBudget - 15))}...[truncado]`
        : entry;
    selectedLines.unshift(clipped);
    charBudget -= clipped.length + 2;
    if (charBudget <= 0) break;
  }

  const transcript =
    selectedLines.length > 0 ? selectedLines.join('\n\n') : '(Sem mensagens anteriores)';

  const roundNote =
    totalRounds > 1
      ? `Esta é a rodada ${round} de ${totalRounds}. ${
          round > 1
            ? 'Leia com atenção o que os outros agentes já responderam nas rodadas anteriores e refine, complemente ou questione pontos específicos.'
            : 'Traga sua primeira contribuição para o debate.'
        }`
      : 'Leia o que já foi dito acima (incluindo respostas de outros agentes) e contribua de forma complementar.';

  const lines = [
    '[REUNIÃO AI OFFICE]',
    `Você é ${speaker.name} (${speaker.roleTitle}) participando de uma reunião colaborativa em grupo no AI Office.`,
    state.topic ? `Pauta da reunião: ${state.topic}` : 'Pauta da reunião: Colaboração geral sobre o workspace.',
    `Participantes presentes:\n${participantList}`,
    '',
    'Histórico recente da conversa:',
    transcript,
    '',
    'Instruções para sua fala:',
    `- ${roundNote}`,
    '- Seja objetivo, claro e colaborativo; evite repetir o que outro agente já disse.',
    '- Não coloque seu próprio nome como prefixo (ex: não comece com "[Nome]:").',
    '- Responda no mesmo idioma da conversa.',
  ];

  return lines.join('\n');
}

export class MeetingManager {
  private deps: MeetingManagerDeps;
  private state: MeetingState;
  private turnQueue: TurnEntry[] = [];
  private activeTurnToken = 0;
  private nextTurnTimer: NodeJS.Timeout | null = null;
  private activeMessageId: string | null = null;
  private idCounter = 0;

  constructor(deps: MeetingManagerDeps) {
    this.deps = deps;
    this.state = {
      active: false,
      topic: '',
      participantIds: [],
      cwd: deps.getDefaultCwd(),
      status: 'idle',
      currentRound: 0,
      maxRounds: 1,
      messages: [],
    };
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }

  private cloneState(): MeetingState {
    return {
      ...this.state,
      participantIds: [...this.state.participantIds],
      messages: this.state.messages.map((m) => ({ ...m })),
    };
  }

  getState(): MeetingState {
    return this.cloneState();
  }

  isAgentBusyInMeeting(agentId: string): boolean {
    if (this.state.status !== 'running') return false;
    return (
      this.state.currentSpeakerId === agentId ||
      this.turnQueue.some((t) => t.agentId === agentId)
    );
  }

  private appendMessage(msg: MeetingMessage): void {
    this.state.messages.push(msg);
    if (this.state.messages.length > MAX_MEETING_MESSAGES) {
      this.state.messages.splice(0, this.state.messages.length - MAX_MEETING_MESSAGES);
    }
    this.deps.broadcast({ type: 'meeting_message_added', message: msg });
  }

  private broadcastMeetingState(): void {
    this.deps.broadcast({ type: 'meeting_updated', meeting: this.cloneState() });
  }

  startMeeting(raw: {
    participantIds: unknown;
    topic?: unknown;
    cwd?: unknown;
    maxRounds?: unknown;
  }): { ok: true } | { ok: false; error: string } {
    const agents = this.deps.getAgents();
    const validIds = new Set(agents.map((a) => a.id));
    const parsedIds = parseMeetingParticipantIds(raw.participantIds, validIds);
    if (!parsedIds || parsedIds.length === 0) {
      return {
        ok: false,
        error: 'Selecione pelo menos 1 agente válido para iniciar a reunião.',
      };
    }

    const validCwd = validateWorkspacePath(raw.cwd, this.deps.getDefaultCwd());
    if (!validCwd) {
      return {
        ok: false,
        error: 'Workspace da reunião inválido ou fora do diretório permitido.',
      };
    }

    if (this.state.status === 'running') {
      this.abortRoundInternal(false);
    }

    const wasActive = this.state.active;
    this.state.active = true;
    this.state.participantIds = parsedIds;
    this.state.topic = parseMeetingTopic(raw.topic, this.state.topic);
    this.state.cwd = validCwd;
    this.state.maxRounds = parseMeetingRounds(raw.maxRounds, this.state.maxRounds || 1);
    this.state.status = 'idle';
    this.state.currentSpeakerId = undefined;
    this.state.currentRound = 0;

    if (!wasActive) {
      const names = parsedIds
        .map((id) => agents.find((a) => a.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      const topicSuffix = this.state.topic ? ` • Pauta: "${this.state.topic}"` : '';
      this.appendMessage({
        id: this.nextId('m-sys'),
        senderType: 'system',
        senderName: 'Sistema',
        content: `Reunião iniciada com ${names.join(', ')}${topicSuffix}.`,
        timestamp: Date.now(),
        status: 'done',
      });
    }

    this.broadcastMeetingState();
    return { ok: true };
  }

  updateMeeting(raw: {
    participantIds?: unknown;
    topic?: unknown;
    cwd?: unknown;
    maxRounds?: unknown;
  }): { ok: true } | { ok: false; error: string } {
    const agents = this.deps.getAgents();
    const validIds = new Set(agents.map((a) => a.id));

    if (raw.participantIds !== undefined) {
      const parsedIds = parseMeetingParticipantIds(raw.participantIds, validIds);
      if (!parsedIds) {
        return { ok: false, error: 'Lista de participantes inválida.' };
      }
      if (this.state.active && parsedIds.length === 0) {
        return {
          ok: false,
          error: 'A reunião precisa ter pelo menos 1 participante ativo.',
        };
      }
      this.state.participantIds = parsedIds;
      const keepSet = new Set(parsedIds);
      this.turnQueue = this.turnQueue.filter((t) => keepSet.has(t.agentId));

      if (
        this.state.status === 'running' &&
        this.state.currentSpeakerId &&
        !keepSet.has(this.state.currentSpeakerId)
      ) {
        this.abortCurrentSpeakerAndContinue();
      }
    }

    if (raw.topic !== undefined) {
      this.state.topic = parseMeetingTopic(raw.topic, '');
    }

    if (raw.cwd !== undefined) {
      const validCwd = validateWorkspacePath(raw.cwd, this.deps.getDefaultCwd());
      if (!validCwd) {
        return {
          ok: false,
          error: 'Workspace da reunião inválido ou fora do diretório permitido.',
        };
      }
      this.state.cwd = validCwd;
    }

    if (raw.maxRounds !== undefined) {
      this.state.maxRounds = parseMeetingRounds(raw.maxRounds, this.state.maxRounds);
    }

    this.broadcastMeetingState();
    return { ok: true };
  }

  sendMessage(raw: {
    content: unknown;
    rounds?: unknown;
  }): { ok: true } | { ok: false; error: string } {
    if (!this.state.active) {
      return { ok: false, error: 'Inicie a reunião antes de enviar mensagens.' };
    }
    if (this.state.status === 'running') {
      return {
        ok: false,
        error: 'Aguarde a rodada atual terminar ou clique em Parar antes de enviar outra mensagem.',
      };
    }

    const content = parseMeetingMessageContent(raw.content);
    if (!content) {
      return {
        ok: false,
        error: 'A mensagem da reunião não pode estar vazia ou exceder 8.000 caracteres.',
      };
    }

    const agents = this.deps.getAgents();
    const agentsById = new Map(agents.map((a) => [a.id, a]));
    const participants = this.state.participantIds
      .map((id) => agentsById.get(id))
      .filter((a): a is AgentRecord => Boolean(a));

    if (participants.length === 0) {
      return {
        ok: false,
        error: 'Nenhum participante disponível na reunião. Adicione agentes primeiro.',
      };
    }

    const targets = resolveTargetParticipants(content, participants);
    const busyTarget = targets.find((t) => this.deps.runner.isRunning(t.id));
    if (busyTarget) {
      return {
        ok: false,
        error: `${busyTarget.name} está executando uma tarefa individual agora. Aguarde ou aborte a tarefa antes de enviar na reunião.`,
      };
    }

    const effectiveRounds = parseMeetingRounds(raw.rounds, this.state.maxRounds || 1);
    this.state.maxRounds = effectiveRounds;

    const userMsg: MeetingMessage = {
      id: this.nextId('m-u'),
      senderType: 'user',
      senderName: 'Você',
      content,
      timestamp: Date.now(),
      status: 'done',
    };
    this.appendMessage(userMsg);

    this.turnQueue = [];
    for (let round = 1; round <= effectiveRounds; round++) {
      for (const target of targets) {
        this.turnQueue.push({ agentId: target.id, round });
      }
    }

    this.state.status = 'running';
    this.state.currentRound = 1;
    this.state.currentSpeakerId = undefined;
    this.broadcastMeetingState();

    this.runNextTurn();
    return { ok: true };
  }

  abortRound(): void {
    this.abortRoundInternal(true);
  }

  private abortRoundInternal(shouldBroadcast: boolean): void {
    this.activeTurnToken += 1;
    if (this.nextTurnTimer) {
      clearTimeout(this.nextTurnTimer);
      this.nextTurnTimer = null;
    }
    this.turnQueue = [];

    const speakerId = this.state.currentSpeakerId;
    const msgId = this.activeMessageId;
    this.activeMessageId = null;

    if (speakerId) {
      this.deps.runner.abort(speakerId);
      const agent = this.deps.getAgents().find((a) => a.id === speakerId);
      if (agent) {
        agent.status = 'idle';
        agent.currentActivity = undefined;
        this.deps.broadcast({
          type: 'agent_status',
          agentId: agent.id,
          status: 'idle',
        });
      }
    }

    if (msgId) {
      const msg = this.state.messages.find((m) => m.id === msgId);
      if (msg && msg.status === 'streaming') {
        msg.status = 'aborted';
        this.deps.broadcast({
          type: 'meeting_message_done',
          messageId: msg.id,
          status: 'aborted',
        });
      }
    }

    this.state.status = 'idle';
    this.state.currentSpeakerId = undefined;
    this.state.currentRound = 0;

    if (shouldBroadcast) {
      this.broadcastMeetingState();
    }
  }

  private abortCurrentSpeakerAndContinue(): void {
    this.activeTurnToken += 1;
    if (this.nextTurnTimer) {
      clearTimeout(this.nextTurnTimer);
      this.nextTurnTimer = null;
    }

    const speakerId = this.state.currentSpeakerId;
    const msgId = this.activeMessageId;
    this.activeMessageId = null;

    if (speakerId) {
      this.deps.runner.abort(speakerId);
      const agent = this.deps.getAgents().find((a) => a.id === speakerId);
      if (agent) {
        agent.status = 'idle';
        agent.currentActivity = undefined;
        this.deps.broadcast({
          type: 'agent_status',
          agentId: agent.id,
          status: 'idle',
        });
      }
    }

    if (msgId) {
      const msg = this.state.messages.find((m) => m.id === msgId);
      if (msg && msg.status === 'streaming') {
        msg.status = 'aborted';
        this.deps.broadcast({
          type: 'meeting_message_done',
          messageId: msg.id,
          status: 'aborted',
        });
      }
    }

    this.state.currentSpeakerId = undefined;
    this.runNextTurn();
  }

  clearHistory(): void {
    if (this.state.status === 'running') {
      this.abortRoundInternal(false);
    }
    this.state.messages = [];
    this.broadcastMeetingState();
  }

  endMeeting(): void {
    if (this.state.status === 'running') {
      this.abortRoundInternal(false);
    }
    if (this.state.active) {
      this.appendMessage({
        id: this.nextId('m-sys'),
        senderType: 'system',
        senderName: 'Sistema',
        content: 'Reunião encerrada. Agentes voltando às atividades do escritório.',
        timestamp: Date.now(),
        status: 'done',
      });
    }
    this.state.active = false;
    this.state.status = 'idle';
    this.state.currentSpeakerId = undefined;
    this.state.currentRound = 0;
    this.broadcastMeetingState();
  }

  handleAgentsRemoved(liveAgentIds: Set<string>): void {
    const before = this.state.participantIds.length;
    this.state.participantIds = this.state.participantIds.filter((id) =>
      liveAgentIds.has(id)
    );
    this.turnQueue = this.turnQueue.filter((t) => liveAgentIds.has(t.agentId));

    const speakerRemoved =
      this.state.currentSpeakerId !== undefined &&
      !liveAgentIds.has(this.state.currentSpeakerId);

    // If all participants are gone while the meeting is active, cleanly end the meeting
    if (this.state.active && this.state.participantIds.length === 0) {
      if (this.state.status === 'running' || speakerRemoved) {
        this.abortRoundInternal(false);
      }
      this.state.active = false;
      this.state.status = 'idle';
      this.state.currentSpeakerId = undefined;
      this.state.currentRound = 0;
      this.appendMessage({
        id: this.nextId('m-sys'),
        senderType: 'system',
        senderName: 'Sistema',
        content: 'Reunião encerrada automaticamente pois todos os participantes saíram.',
        timestamp: Date.now(),
        status: 'done',
      });
      this.broadcastMeetingState();
      return;
    }

    if (speakerRemoved) {
      this.abortCurrentSpeakerAndContinue();
      return;
    }

    if (this.state.participantIds.length !== before) {
      this.broadcastMeetingState();
    }
  }

  private runNextTurn(): void {
    const agents = this.deps.getAgents();
    const agentsById = new Map(agents.map((a) => [a.id, a]));

    let next: TurnEntry | undefined;
    let speaker: AgentRecord | undefined;
    while (this.turnQueue.length > 0) {
      const candidate = this.turnQueue.shift()!;
      const found = agentsById.get(candidate.agentId);
      if (found) {
        next = candidate;
        speaker = found;
        break;
      }
    }

    if (!next || !speaker) {
      this.state.status = 'idle';
      this.state.currentSpeakerId = undefined;
      this.state.currentRound = 0;
      this.activeMessageId = null;
      this.broadcastMeetingState();
      return;
    }

    const token = ++this.activeTurnToken;
    this.state.currentSpeakerId = speaker.id;
    this.state.currentRound = next.round;

    const participants = this.state.participantIds
      .map((id) => agentsById.get(id))
      .filter((a): a is AgentRecord => Boolean(a));

    const prompt = buildMeetingPrompt(
      speaker,
      participants,
      this.state,
      next.round,
      this.state.maxRounds
    );

    const agentMsg: MeetingMessage = {
      id: this.nextId('m-a'),
      senderType: 'agent',
      senderId: speaker.id,
      senderName: speaker.name,
      senderRole: speaker.roleTitle,
      senderColor: speaker.appearance.shirtColor,
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
      toolActivity: 'Lendo a conversa da reunião...',
      round: next.round,
    };
    this.activeMessageId = agentMsg.id;
    this.appendMessage(agentMsg);

    speaker.status = 'working';
    speaker.currentActivity = 'Na reunião: respondendo...';
    this.deps.broadcast({
      type: 'agent_status',
      agentId: speaker.id,
      status: 'working',
      currentActivity: speaker.currentActivity,
    });
    this.broadcastMeetingState();

    const providers = this.deps.getProviders();
    const provider =
      providers.find((p) => p.id === speaker.provider) ||
      providers.find((p) => p.id === 'demo')!;

    const speakerRef = speaker;

    this.deps.runner.run(speakerRef, provider, prompt, this.state.cwd, {
      onActivity: (activity) => {
        if (token !== this.activeTurnToken) return;
        const label = activity.startsWith('Na reunião')
          ? activity
          : `Na reunião: ${activity}`;
        speakerRef.currentActivity = label;
        agentMsg.toolActivity = label;
        this.deps.broadcast({
          type: 'agent_status',
          agentId: speakerRef.id,
          status: 'working',
          currentActivity: label,
        });
      },
      onChunk: (chunk, toolActivity) => {
        if (token !== this.activeTurnToken) return;
        agentMsg.content += chunk;
        if (toolActivity) agentMsg.toolActivity = toolActivity;
        this.deps.broadcast({
          type: 'meeting_message_chunk',
          messageId: agentMsg.id,
          chunk,
          toolActivity,
        });
      },
      onDone: (status) => {
        if (token !== this.activeTurnToken) return;
        this.activeMessageId = null;
        agentMsg.status = status;
        this.deps.broadcast({
          type: 'meeting_message_done',
          messageId: agentMsg.id,
          status,
        });

        speakerRef.status = status === 'error' ? 'error' : 'idle';
        speakerRef.currentActivity = undefined;
        this.deps.broadcast({
          type: 'agent_status',
          agentId: speakerRef.id,
          status: speakerRef.status,
        });

        if (status === 'error') {
          setTimeout(() => {
            if (speakerRef.status === 'error') {
              speakerRef.status = 'idle';
              this.deps.broadcast({
                type: 'agent_status',
                agentId: speakerRef.id,
                status: 'idle',
              });
            }
          }, 4000);
        }

        const gap = this.deps.turnGapMs ?? TURN_GAP_MS;
        if (this.turnQueue.length === 0 || gap <= 0) {
          this.runNextTurn();
        } else {
          this.nextTurnTimer = setTimeout(() => {
            this.nextTurnTimer = null;
            if (token !== this.activeTurnToken) return;
            this.runNextTurn();
          }, gap);
        }
      },
    });
  }
}

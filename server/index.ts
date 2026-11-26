import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentRunner } from './agentRunner.ts';
import { detectProviders } from './cliRegistry.ts';
import { MeetingManager } from './meetingManager.ts';
import {
  ALLOWED_HOSTS,
  ALLOWED_ORIGINS,
  extractRequestToken,
  initSessionToken,
  isAllowedHost,
  isAllowedOrigin,
  isSameSiteBootstrapRequest,
  parseCreateAgentPayload,
  parseHookPayload,
  parseUpdateAgentPatch,
  safeCompareToken,
  sanitizeAppearance,
  sanitizeString,
  validateProviderId,
  validateWorkspacePath,
  verifyWebSocketUpgrade,
} from './security.ts';
import {
  TerminalWatcher,
  type DetectedTerminalAgent,
} from './terminalWatcher.ts';
import { readLatestAgentSummary } from './transcriptReader.ts';
import type {
  AgentAppearance,
  AgentRecord,
  ChatMessage,
  OfficeStateSnapshot,
  ProviderId,
  WsClientMessage,
  WsServerMessage,
} from './types.ts';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const CONFIG_PATH = path.resolve(process.cwd(), 'office-config.json');
const TOKEN_PATH = path.resolve(process.cwd(), '.office-session-token');

const MAX_MANUAL_AGENTS = 12;
const MAX_MESSAGES_PER_AGENT = 100;
const MAX_PROMPT_LENGTH = 16_000;
const MAX_HOOK_OVERRIDES = 100;

const SESSION_TOKEN = initSessionToken(TOKEN_PATH);

interface PersistedConfig {
  version?: number;
  defaultCwd: string;
  manualAgents: Array<
    Omit<AgentRecord, 'status' | 'currentActivity' | 'messages' | 'terminalPid'>
  >;
}

const PROVIDER_PERSONAS: Record<
  ProviderId,
  { baseName: string; roleTitle: string; appearance: AgentAppearance }
> = {
  claude: {
    baseName: 'Cláudio',
    roleTitle: 'Claude Code (Terminal)',
    appearance: {
      hairColor: '#4a2c2a',
      skinColor: '#f1c27d',
      shirtColor: '#e07a5f',
      pantsColor: '#2b3a4a',
      accessory: 'glasses',
    },
  },
  agy: {
    baseName: 'Nova',
    roleTitle: 'Antigravity CLI (Terminal)',
    appearance: {
      hairColor: '#7c3aed',
      skinColor: '#c68642',
      shirtColor: '#8b5cf6',
      pantsColor: '#1e1b4b',
      accessory: 'headphones',
    },
  },
  gemini: {
    baseName: 'Gema',
    roleTitle: 'Gemini CLI (Terminal)',
    appearance: {
      hairColor: '#1f2937',
      skinColor: '#e0ac69',
      shirtColor: '#3b82f6',
      pantsColor: '#1e293b',
      accessory: 'headphones',
    },
  },
  codex: {
    baseName: 'Caco',
    roleTitle: 'Codex CLI (Terminal)',
    appearance: {
      hairColor: '#d97706',
      skinColor: '#ffdbac',
      shirtColor: '#10b981',
      pantsColor: '#334155',
      accessory: 'cap',
    },
  },
  aider: {
    baseName: 'Aida',
    roleTitle: 'Aider (Terminal)',
    appearance: {
      hairColor: '#991b1b',
      skinColor: '#f1c27d',
      shirtColor: '#f59e0b',
      pantsColor: '#1e293b',
      accessory: 'glasses',
    },
  },
  custom: {
    baseName: 'Agente',
    roleTitle: 'CLI Customizado',
    appearance: {
      hairColor: '#1f2937',
      skinColor: '#e0ac69',
      shirtColor: '#ec4899',
      pantsColor: '#1e293b',
      accessory: 'none',
    },
  },
  demo: {
    baseName: 'Simulador',
    roleTitle: 'Modo Simulação',
    appearance: {
      hairColor: '#334155',
      skinColor: '#ffdbac',
      shirtColor: '#38bdf8',
      pantsColor: '#1e293b',
      accessory: 'none',
    },
  },
};

let providers = detectProviders();
let defaultCwd = path.resolve(os.homedir(), 'Área de Trabalho');
if (!fs.existsSync(defaultCwd)) {
  defaultCwd = os.homedir();
}

let agents: AgentRecord[] = [];
const hookOverrides = new Map<
  string,
  { status: 'working' | 'idle'; activity?: string; expiresAt: number }
>();

function pruneHookOverrides(now: number): void {
  for (const [k, v] of hookOverrides.entries()) {
    if (v.expiresAt <= now) {
      hookOverrides.delete(k);
    }
  }
  while (hookOverrides.size >= MAX_HOOK_OVERRIDES) {
    const oldestKey = hookOverrides.keys().next().value;
    if (oldestKey === undefined) break;
    hookOverrides.delete(oldestKey);
  }
}

function loadState(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      fs.chmodSync(CONFIG_PATH, 0o600);
    } catch {
      // ignore chmod errors on unsupported fs
    }
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as PersistedConfig;
      const validDefault = validateWorkspacePath(raw.defaultCwd, defaultCwd);
      if (validDefault) defaultCwd = validDefault;

      if (raw.version === 2 && Array.isArray(raw.manualAgents)) {
        agents = raw.manualAgents
          .slice(0, MAX_MANUAL_AGENTS)
          .map((a, idx): AgentRecord | null => {
            const prov = validateProviderId(a.provider);
            const name = sanitizeString(a.name, 40);
            const cwd = validateWorkspacePath(a.cwd, defaultCwd);
            if (!prov || !name || !cwd) return null;
            return {
              id: sanitizeString(a.id, 64) || `agent-loaded-${idx}`,
              name,
              roleTitle: sanitizeString(a.roleTitle, 60, 'Agente IA') || 'Agente IA',
              provider: prov,
              origin: 'manual',
              customCommand:
                prov === 'custom' ? sanitizeString(a.customCommand, 300) : undefined,
              cwd,
              deskIndex:
                typeof a.deskIndex === 'number' && Number.isInteger(a.deskIndex)
                  ? ((a.deskIndex % 6) + 6) % 6
                  : idx % 6,
              appearance: sanitizeAppearance(a.appearance),
              status: 'idle',
              messages: [],
            };
          })
          .filter((x): x is AgentRecord => Boolean(x));
        return;
      }
    } catch {
      // ignore corrupted config
    }
  }
  agents = [];
  saveState();
}

function saveState(): void {
  const payload: PersistedConfig = {
    version: 2,
    defaultCwd,
    manualAgents: agents
      .filter((a) => a.origin === 'manual')
      .map(
        ({
          status: _s,
          currentActivity: _c,
          messages: _m,
          terminalPid: _p,
          lastSummary: _l,
          ...rest
        }) => rest
      ),
  };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.chmodSync(CONFIG_PATH, 0o600);
  } catch (err) {
    console.error('Failed to persist office-config.json:', err);
  }
}

loadState();

const app = express();
app.disable('x-powered-by');

// Defensive HTTP security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});

// Strict Host validation against DNS rebinding
app.use((req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    res.status(403).json({ error: 'Host não permitido' });
    return;
  }
  next();
});

// Strict origin-based CORS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    res.status(403).json({ error: 'Origem não permitida' });
    return;
  }
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Office-Token', 'X-Office-Bootstrap', 'Authorization'],
  })
);

app.use(express.json({ limit: '64kb' }));

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractRequestToken(req);
  if (!safeCompareToken(token, SESSION_TOKEN)) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Reject GET session bootstrap; require POST with custom header & Host/Origin validation
app.get('/api/session', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.setHeader('Cache-Control', 'no-store');
  res.status(405).json({ error: 'Método não permitido. Use POST /api/session.' });
});

// Local same-origin session bootstrap for the web UI (HttpOnly cookie only; never returns token in JSON)
app.post('/api/session', (req, res) => {
  if (!isSameSiteBootstrapRequest(req)) {
    res.status(403).json({ error: 'Origem ou host não permitido' });
    return;
  }
  res.setHeader(
    'Set-Cookie',
    `office_token=${encodeURIComponent(SESSION_TOKEN)}; HttpOnly; SameSite=Strict; Path=/`
  );
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true });
});

app.get('/api/state', requireAuth, (_req, res) => {
  res.json(getSnapshot());
});

app.get('/api/agents/:id/summary', requireAuth, async (req, res) => {
  const agent = agents.find((a) => a.id === req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agente não encontrado' });
    return;
  }
  const summary = await readLatestAgentSummary(agent);
  agent.lastSummary = summary;
  res.json({ summary });
});

/**
 * Authenticated webhook endpoint for CLI hooks (e.g. Claude Code PreToolUse / PostToolUse / Stop)
 * Header: X-Office-Token: <token from .office-session-token>
 */
app.post('/api/hook', requireAuth, (req, res) => {
  const parsed = parseHookPayload(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'Payload inválido' });
    return;
  }

  const now = Date.now();
  pruneHookOverrides(now);

  const key = parsed.pid ? `pid:${parsed.pid}` : `provider:${parsed.provider}`;

  if (parsed.event === 'stop' || parsed.event === 'idle' || parsed.event === 'notification') {
    hookOverrides.set(key, {
      status: 'idle',
      expiresAt: now + 8000,
    });
  } else {
    const label = parsed.tool
      ? `${parsed.tool}${parsed.detail ? `: ${parsed.detail}` : '...'}`
      : 'Trabalhando no terminal...';
    hookOverrides.set(key, {
      status: 'working',
      activity: label,
      expiresAt: now + 15000,
    });
  }

  for (const agent of agents) {
    if (agent.origin !== 'terminal') continue;
    if (runner.isRunning(agent.id)) continue;
    if (
      (parsed.pid && agent.terminalPid === parsed.pid) ||
      (!parsed.pid && agent.provider === parsed.provider)
    ) {
      const ov = hookOverrides.get(key)!;
      agent.status = ov.status;
      agent.currentActivity = ov.activity;
      broadcast({
        type: 'agent_status',
        agentId: agent.id,
        status: agent.status,
        currentActivity: agent.currentActivity,
      });
    }
  }

  res.json({ ok: true });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const isSyntax = err instanceof SyntaxError;
  res.status(isSyntax ? 400 : 500).json({
    error: isSyntax ? 'JSON inválido' : 'Erro interno do servidor',
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 64 * 1024,
  verifyClient: (info, done) => {
    try {
      const verdict = verifyWebSocketUpgrade(info, SESSION_TOKEN);
      if (!verdict.ok) {
        done(false, verdict.code, verdict.reason);
        return;
      }
      done(true);
    } catch {
      done(false, 400, 'Bad Request');
    }
  },
});

const runner = new AgentRunner();
const meetingManager = new MeetingManager({
  getAgents: () => agents,
  getProviders: () => providers,
  getDefaultCwd: () => defaultCwd,
  runner,
  broadcast,
});

function getSnapshot(): OfficeStateSnapshot {
  return {
    defaultCwd,
    providers,
    agents,
    meeting: meetingManager.getState(),
  };
}

function broadcast(msg: WsServerMessage): void {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

function sendTo(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function findNextFreeDesk(): number {
  const used = new Set(agents.map((a) => a.deskIndex));
  for (let i = 0; i < 6; i++) {
    if (!used.has(i)) return i;
  }
  return agents.length % 6;
}

function appendMessageBounded(agent: AgentRecord, msg: ChatMessage): void {
  agent.messages.push(msg);
  if (agent.messages.length > MAX_MESSAGES_PER_AGENT) {
    agent.messages.splice(0, agent.messages.length - MAX_MESSAGES_PER_AGENT);
  }
}

function syncTerminalAgents(detected: DetectedTerminalAgent[]): void {
  const now = Date.now();
  pruneHookOverrides(now);

  let structureChanged = false;
  const livePids = new Set(detected.map((d) => d.pid));

  const beforeLen = agents.length;
  agents = agents.filter((a) => {
    if (a.origin !== 'terminal') return true;
    if (runner.isRunning(a.id)) return true;
    return a.terminalPid !== undefined && livePids.has(a.terminalPid);
  });
  if (agents.length !== beforeLen) {
    meetingManager.handleAgentsRemoved(new Set(agents.map((a) => a.id)));
    structureChanged = true;
  }

  for (const proc of detected) {
    let agent = agents.find(
      (a) => a.origin === 'terminal' && a.terminalPid === proc.pid
    );

    const validProcCwd = proc.cwd ? validateWorkspacePath(proc.cwd, defaultCwd) : null;
    const resolvedCwd = validProcCwd || agent?.cwd || defaultCwd;

    if (!agent) {
      const persona = PROVIDER_PERSONAS[proc.provider] || PROVIDER_PERSONAS.custom;
      const sameProviderCount = agents.filter(
        (a) => a.origin === 'terminal' && a.provider === proc.provider
      ).length;
      const name =
        sameProviderCount === 0
          ? persona.baseName
          : `${persona.baseName} #${sameProviderCount + 1}`;

      agent = {
        id: `term-${proc.provider}-${proc.pid}`,
        name,
        roleTitle: `${persona.roleTitle} • ${proc.projectName}`,
        provider: proc.provider,
        origin: 'terminal',
        terminalPid: proc.pid,
        cwd: resolvedCwd,
        deskIndex: findNextFreeDesk(),
        appearance: { ...persona.appearance },
        status: proc.busy ? 'working' : 'idle',
        currentActivity: proc.activityHint,
        messages: [],
      };
      agents.push(agent);
      structureChanged = true;
      continue;
    }

    if (runner.isRunning(agent.id)) continue;

    if (validProcCwd && agent.cwd !== validProcCwd) {
      agent.cwd = validProcCwd;
      const persona = PROVIDER_PERSONAS[proc.provider] || PROVIDER_PERSONAS.custom;
      agent.roleTitle = `${persona.roleTitle} • ${proc.projectName}`;
      structureChanged = true;
    }

    const pidHook = hookOverrides.get(`pid:${proc.pid}`);
    const provHook = hookOverrides.get(`provider:${proc.provider}`);
    const activeHook =
      pidHook && pidHook.expiresAt > now
        ? pidHook
        : provHook && provHook.expiresAt > now
          ? provHook
          : undefined;

    const nextStatus: AgentRecord['status'] = activeHook
      ? activeHook.status
      : proc.busy
        ? 'working'
        : 'idle';
    const nextActivity = activeHook ? activeHook.activity : proc.activityHint;

    if (agent.status !== nextStatus || agent.currentActivity !== nextActivity) {
      agent.status = nextStatus;
      agent.currentActivity = nextActivity;
      broadcast({
        type: 'agent_status',
        agentId: agent.id,
        status: agent.status,
        currentActivity: agent.currentActivity,
      });
    }
  }

  if (structureChanged) {
    broadcast({ type: 'snapshot', data: getSnapshot() });
  }
}

const terminalWatcher = new TerminalWatcher(
  () => runner.getActivePids(),
  syncTerminalAgents
);
terminalWatcher.start(1500);

function handleClientMessage(ws: WebSocket, rawMsg: unknown): void {
  if (!rawMsg || typeof rawMsg !== 'object' || typeof (rawMsg as { type?: unknown }).type !== 'string') {
    sendTo(ws, { type: 'error', message: 'Mensagem inválida.' });
    return;
  }

  const msg = rawMsg as WsClientMessage;

  switch (msg.type) {
    case 'refresh_providers': {
      providers = detectProviders();
      terminalWatcher.scan();
      broadcast({ type: 'providers_updated', providers });
      return;
    }

    case 'set_default_cwd': {
      const validCwd = validateWorkspacePath(msg.cwd, defaultCwd);
      if (!validCwd) {
        sendTo(ws, {
          type: 'error',
          message: 'Diretório inválido ou fora do escopo permitido (home do usuário).',
        });
        return;
      }
      defaultCwd = validCwd;
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'create_agent': {
      const manualCount = agents.filter((a) => a.origin === 'manual').length;
      if (manualCount >= MAX_MANUAL_AGENTS) {
        sendTo(ws, {
          type: 'error',
          message: `Limite máximo de ${MAX_MANUAL_AGENTS} agentes manuais atingido.`,
        });
        return;
      }
      const validated = parseCreateAgentPayload(msg.agent, defaultCwd);
      if (!validated) {
        sendTo(ws, {
          type: 'error',
          message: 'Dados inválidos para criar agente (verifique nome, provedor e diretório).',
        });
        return;
      }
      const newAgent: AgentRecord = {
        ...validated,
        id: `agent-${Date.now().toString(36)}`,
        origin: 'manual',
        deskIndex:
          validated.deskIndex !== undefined
            ? validated.deskIndex
            : findNextFreeDesk(),
        status: 'idle',
        messages: [],
      };
      agents.push(newAgent);
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'update_agent': {
      if (typeof msg.agentId !== 'string') return;
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      const patch = parseUpdateAgentPatch(msg.patch, agent, defaultCwd);
      if (!patch) {
        sendTo(ws, {
          type: 'error',
          message: 'Alteração inválida (verifique provedor, nome ou diretório).',
        });
        return;
      }
      if (patch.name !== undefined) agent.name = patch.name;
      if (patch.roleTitle !== undefined) agent.roleTitle = patch.roleTitle;
      if (patch.provider !== undefined) agent.provider = patch.provider;
      if ('customCommand' in patch) agent.customCommand = patch.customCommand;
      if (patch.cwd !== undefined) agent.cwd = patch.cwd;
      if (patch.appearance !== undefined) agent.appearance = patch.appearance;
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'delete_agent': {
      if (typeof msg.agentId !== 'string') return;
      runner.abort(msg.agentId);
      agents = agents.filter((a) => a.id !== msg.agentId);
      meetingManager.handleAgentsRemoved(new Set(agents.map((a) => a.id)));
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'clear_history': {
      if (typeof msg.agentId !== 'string') return;
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      agent.messages = [];
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'abort_task': {
      if (typeof msg.agentId !== 'string') return;
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      if (meetingManager.isAgentBusyInMeeting(agent.id)) {
        meetingManager.abortRound();
        return;
      }
      runner.abort(agent.id);
      agent.status = 'idle';
      agent.currentActivity = undefined;
      broadcast({ type: 'agent_status', agentId: agent.id, status: 'idle' });
      return;
    }

    case 'start_meeting': {
      const res = meetingManager.startMeeting({
        participantIds: msg.participantIds,
        topic: msg.topic,
        cwd: msg.cwd,
        maxRounds: msg.maxRounds,
      });
      if (!res.ok) {
        sendTo(ws, { type: 'error', message: res.error });
      }
      return;
    }

    case 'update_meeting': {
      const res = meetingManager.updateMeeting({
        participantIds: msg.participantIds,
        topic: msg.topic,
        cwd: msg.cwd,
        maxRounds: msg.maxRounds,
      });
      if (!res.ok) {
        sendTo(ws, { type: 'error', message: res.error });
      }
      return;
    }

    case 'send_meeting_message': {
      const res = meetingManager.sendMessage({
        content: msg.content,
        rounds: msg.rounds,
      });
      if (!res.ok) {
        sendTo(ws, { type: 'error', message: res.error });
      }
      return;
    }

    case 'abort_meeting': {
      meetingManager.abortRound();
      return;
    }

    case 'clear_meeting_history': {
      meetingManager.clearHistory();
      return;
    }

    case 'end_meeting': {
      meetingManager.endMeeting();
      return;
    }

    case 'run_task': {
      if (typeof msg.agentId !== 'string' || typeof msg.prompt !== 'string') {
        sendTo(ws, { type: 'error', message: 'Prompt ou agente inválido.' });
        return;
      }
      const prompt = msg.prompt.trim();
      if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
        sendTo(ws, {
          type: 'error',
          message: `O prompt deve ter entre 1 e ${MAX_PROMPT_LENGTH} caracteres.`,
        });
        return;
      }

      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) {
        sendTo(ws, { type: 'error', message: 'Agente não encontrado.' });
        return;
      }

      if (meetingManager.isAgentBusyInMeeting(agent.id)) {
        sendTo(ws, {
          type: 'error',
          message: `${agent.name} está participando de uma rodada ativa na reunião. Pare ou aguarde a rodada terminar.`,
        });
        return;
      }

      const taskCwd = validateWorkspacePath(msg.cwd ?? agent.cwd, defaultCwd);
      if (!taskCwd) {
        sendTo(ws, {
          type: 'error',
          message: 'Workspace inválido ou fora do diretório permitido.',
        });
        return;
      }

      const provider =
        providers.find((p) => p.id === agent.provider) ||
        providers.find((p) => p.id === 'demo')!;

      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now().toString(36)}`,
        role: 'user',
        content: prompt,
        timestamp: Date.now(),
        status: 'done',
      };
      appendMessageBounded(agent, userMsg);
      broadcast({ type: 'message_added', agentId: agent.id, message: userMsg });

      const assistantMsg: ChatMessage = {
        id: `msg-a-${(Date.now() + 1).toString(36)}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
        toolActivity: 'Indo para a mesa...',
      };
      appendMessageBounded(agent, assistantMsg);
      broadcast({ type: 'message_added', agentId: agent.id, message: assistantMsg });

      agent.status = 'working';
      agent.currentActivity = 'Iniciando tarefa...';
      broadcast({
        type: 'agent_status',
        agentId: agent.id,
        status: 'working',
        currentActivity: agent.currentActivity,
      });

      runner.run(agent, provider, prompt, taskCwd, {
        onActivity: (activity) => {
          agent.currentActivity = activity;
          assistantMsg.toolActivity = activity;
          broadcast({
            type: 'agent_status',
            agentId: agent.id,
            status: 'working',
            currentActivity: activity,
          });
        },
        onChunk: (chunk, toolActivity) => {
          assistantMsg.content += chunk;
          if (toolActivity) assistantMsg.toolActivity = toolActivity;
          broadcast({
            type: 'message_chunk',
            agentId: agent.id,
            messageId: assistantMsg.id,
            chunk,
            toolActivity,
          });
        },
        onDone: (status) => {
          assistantMsg.status = status;
          agent.status = status === 'error' ? 'error' : 'idle';
          agent.currentActivity = undefined;
          broadcast({
            type: 'message_done',
            agentId: agent.id,
            messageId: assistantMsg.id,
            status,
          });
          broadcast({
            type: 'agent_status',
            agentId: agent.id,
            status: agent.status,
          });
          if (status === 'error') {
            setTimeout(() => {
              if (agent.status === 'error') {
                agent.status = 'idle';
                broadcast({ type: 'agent_status', agentId: agent.id, status: 'idle' });
              }
            }, 4000);
          }
        },
      });
      return;
    }

    default:
      sendTo(ws, { type: 'error', message: 'Tipo de mensagem não suportado.' });
  }
}

wss.on('connection', (ws) => {
  sendTo(ws, { type: 'snapshot', data: getSnapshot() });

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      handleClientMessage(ws, parsed);
    } catch (err) {
      sendTo(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : 'Mensagem inválida',
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  const installed = providers
    .filter((p) => p.installed && p.id !== 'demo' && p.id !== 'custom')
    .map((p) => p.binary);
  console.log(`\n🏢 AI Office Server rodando em http://${HOST}:${PORT}`);
  console.log(`🔒 Origens permitidas: ${Array.from(ALLOWED_ORIGINS).join(', ')}`);
  console.log(`🛡️ Hosts permitidos: ${Array.from(ALLOWED_HOSTS).join(', ')}`);
  console.log(`🔑 Token de sessão salvo em ${TOKEN_PATH} (permissão 0600)`);
  console.log(
    `🤖 CLIs detectados: ${installed.length > 0 ? installed.join(', ') : 'nenhum (modo demo ativo)'}`
  );
  console.log(`👀 Monitorando agentes iniciados via terminal...\n`);
});

import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { AgentRunner } from './agentRunner.ts';
import { detectProviders } from './cliRegistry.ts';
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
const CONFIG_PATH = path.resolve(process.cwd(), 'office-config.json');

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
// Optional webhook overrides (e.g., Claude Code hooks) per provider or pid
const hookOverrides = new Map<
  string,
  { status: 'working' | 'idle'; activity?: string; expiresAt: number }
>();

function loadState(): void {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as PersistedConfig;
      if (raw.defaultCwd) defaultCwd = raw.defaultCwd;
      if (raw.version === 2 && Array.isArray(raw.manualAgents)) {
        agents = raw.manualAgents.map((a, idx) => ({
          ...a,
          origin: 'manual',
          deskIndex: typeof a.deskIndex === 'number' ? a.deskIndex : idx % 6,
          status: 'idle',
          messages: [],
        }));
        return;
      }
    } catch {
      // ignore corrupted config
    }
  }
  // Start clean: terminal agents will populate automatically via TerminalWatcher
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
          ...rest
        }) => rest
      ),
  };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to persist office-config.json:', err);
  }
}

loadState();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    providersCount: providers.length,
    agentsCount: agents.length,
    terminalAgents: agents.filter((a) => a.origin === 'terminal').length,
  });
});

app.get('/api/state', (_req, res) => {
  res.json(getSnapshot());
});

app.get('/api/agents/:id/summary', (req, res) => {
  const agent = agents.find((a) => a.id === req.params.id);
  if (!agent) {
    res.status(404).json({ error: 'Agente não encontrado' });
    return;
  }
  const summary = readLatestAgentSummary(agent);
  agent.lastSummary = summary;
  res.json({ summary });
});

/**
 * Optional webhook endpoint for CLI hooks (e.g. Claude Code PreToolUse / PostToolUse / Stop)
 * Example: curl -X POST http://localhost:3001/api/hook -H 'Content-Type: application/json' \
 *   -d '{"provider":"claude","event":"PreToolUse","tool":"Edit","detail":"App.tsx"}'
 */
app.post('/api/hook', (req, res) => {
  const body = (req.body || {}) as {
    provider?: ProviderId;
    pid?: number;
    event?: string;
    tool?: string;
    detail?: string;
  };
  const provider = body.provider || 'claude';
  const key = body.pid ? `pid:${body.pid}` : `provider:${provider}`;
  const event = (body.event || '').toLowerCase();

  if (event === 'stop' || event === 'idle' || event === 'notification') {
    hookOverrides.set(key, {
      status: 'idle',
      expiresAt: Date.now() + 8000,
    });
  } else {
    const label = body.tool
      ? `${body.tool}${body.detail ? `: ${body.detail}` : '...'}`
      : 'Trabalhando no terminal...';
    hookOverrides.set(key, {
      status: 'working',
      activity: label,
      expiresAt: Date.now() + 15000,
    });
  }

  // Trigger an immediate status refresh on matching terminal agents
  for (const agent of agents) {
    if (agent.origin !== 'terminal') continue;
    if (
      (body.pid && agent.terminalPid === body.pid) ||
      (!body.pid && agent.provider === provider)
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

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const runner = new AgentRunner();

function getSnapshot(): OfficeStateSnapshot {
  return {
    defaultCwd,
    providers,
    agents,
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

function syncTerminalAgents(detected: DetectedTerminalAgent[]): void {
  const now = Date.now();
  let structureChanged = false;
  const livePids = new Set(detected.map((d) => d.pid));

  // Remove terminal agents whose CLI process exited (unless running a web task)
  const beforeLen = agents.length;
  agents = agents.filter((a) => {
    if (a.origin !== 'terminal') return true;
    if (runner.isRunning(a.id)) return true;
    return a.terminalPid !== undefined && livePids.has(a.terminalPid);
  });
  if (agents.length !== beforeLen) {
    structureChanged = true;
  }

  // Add or update detected terminal processes
  for (const proc of detected) {
    let agent = agents.find(
      (a) => a.origin === 'terminal' && a.terminalPid === proc.pid
    );

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
        cwd: proc.cwd,
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

    // Do not overwrite if this agent is currently running a web-triggered task
    if (runner.isRunning(agent.id)) continue;

    // Update cwd if terminal changed directory
    if (agent.cwd !== proc.cwd) {
      agent.cwd = proc.cwd;
      const persona = PROVIDER_PERSONAS[proc.provider] || PROVIDER_PERSONAS.custom;
      agent.roleTitle = `${persona.roleTitle} • ${proc.projectName}`;
      structureChanged = true;
    }

    // Apply webhook override if fresh, otherwise use process activity detection
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

function handleClientMessage(ws: WebSocket, msg: WsClientMessage): void {
  switch (msg.type) {
    case 'refresh_providers': {
      providers = detectProviders();
      terminalWatcher.scan();
      broadcast({ type: 'providers_updated', providers });
      return;
    }

    case 'set_default_cwd': {
      defaultCwd = msg.cwd.trim() || defaultCwd;
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'create_agent': {
      const newAgent: AgentRecord = {
        ...msg.agent,
        id: `agent-${Date.now().toString(36)}`,
        origin: 'manual',
        deskIndex:
          typeof msg.agent.deskIndex === 'number'
            ? msg.agent.deskIndex
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
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      Object.assign(agent, msg.patch);
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'delete_agent': {
      runner.abort(msg.agentId);
      agents = agents.filter((a) => a.id !== msg.agentId);
      saveState();
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'clear_history': {
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      agent.messages = [];
      broadcast({ type: 'snapshot', data: getSnapshot() });
      return;
    }

    case 'abort_task': {
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) return;
      runner.abort(agent.id);
      agent.status = 'idle';
      agent.currentActivity = undefined;
      broadcast({ type: 'agent_status', agentId: agent.id, status: 'idle' });
      return;
    }

    case 'run_task': {
      const agent = agents.find((a) => a.id === msg.agentId);
      if (!agent) {
        sendTo(ws, { type: 'error', message: 'Agente não encontrado.' });
        return;
      }

      const provider =
        providers.find((p) => p.id === agent.provider) ||
        providers.find((p) => p.id === 'demo')!;

      const userMsg: ChatMessage = {
        id: `msg-u-${Date.now().toString(36)}`,
        role: 'user',
        content: msg.prompt,
        timestamp: Date.now(),
        status: 'done',
      };
      agent.messages.push(userMsg);
      broadcast({ type: 'message_added', agentId: agent.id, message: userMsg });

      const assistantMsg: ChatMessage = {
        id: `msg-a-${(Date.now() + 1).toString(36)}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'streaming',
        toolActivity: 'Indo para a mesa...',
      };
      agent.messages.push(assistantMsg);
      broadcast({ type: 'message_added', agentId: agent.id, message: assistantMsg });

      agent.status = 'working';
      agent.currentActivity = 'Iniciando tarefa...';
      broadcast({
        type: 'agent_status',
        agentId: agent.id,
        status: 'working',
        currentActivity: agent.currentActivity,
      });

      const taskCwd = msg.cwd?.trim() || agent.cwd || defaultCwd;

      runner.run(agent, provider, msg.prompt, taskCwd, {
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
    }
  }
}

wss.on('connection', (ws) => {
  sendTo(ws, { type: 'snapshot', data: getSnapshot() });

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as WsClientMessage;
      handleClientMessage(ws, parsed);
    } catch (err) {
      sendTo(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : 'Mensagem inválida',
      });
    }
  });
});

server.listen(PORT, () => {
  const installed = providers
    .filter((p) => p.installed && p.id !== 'demo' && p.id !== 'custom')
    .map((p) => p.binary);
  console.log(`\n🏢 AI Office Server rodando em http://localhost:${PORT}`);
  console.log(
    `🤖 CLIs detectados: ${installed.length > 0 ? installed.join(', ') : 'nenhum (modo demo ativo)'}`
  );
  console.log(`👀 Monitorando agentes iniciados via terminal...\n`);
});

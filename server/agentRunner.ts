import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { buildCliInvocation } from './cliRegistry.ts';
import { validateWorkspacePath } from './security.ts';
import type { AgentRecord, CliProviderInfo } from './types.ts';

const MAX_CONCURRENT_TASKS = 4;
const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OUTPUT_BYTES = 256 * 1024; // 256 KB per run

interface RunningTask {
  kind: 'process' | 'demo';
  proc?: ChildProcess;
  timers?: NodeJS.Timeout[];
  timeoutTimer?: NodeJS.Timeout;
  aborted: boolean;
}

export interface RunnerCallbacks {
  onChunk: (chunk: string, toolActivity?: string) => void;
  onActivity: (activity: string) => void;
  onDone: (status: 'done' | 'error' | 'aborted', finalContent?: string) => void;
}

function inferActivityFromOutput(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes('read') || lower.includes('lendo') || lower.includes('inspect')) {
    return 'Lendo arquivos...';
  }
  if (lower.includes('edit') || lower.includes('write') || lower.includes('escrev')) {
    return 'Editando código...';
  }
  if (lower.includes('bash') || lower.includes('run') || lower.includes('exec') || lower.includes('test')) {
    return 'Rodando comando...';
  }
  if (lower.includes('search') || lower.includes('grep') || lower.includes('pesquis')) {
    return 'Pesquisando no projeto...';
  }
  if (lower.includes('plan') || lower.includes('think') || lower.includes('analis')) {
    return 'Analisando solução...';
  }
  return undefined;
}

function killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
  if (!proc.pid) return;
  try {
    // Negative PID kills the entire process group (detached: true)
    process.kill(-proc.pid, signal);
  } catch {
    try {
      proc.kill(signal);
    } catch {
      // process already exited
    }
  }
}

const COMMON_SAFE_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LANGUAGE',
  'TZ',
  'TERM',
  'COLORTERM',
  'TMPDIR',
  'TEMP',
  'TMP',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'XDG_RUNTIME_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'EDITOR',
  'VISUAL',
]);

const ALWAYS_BLOCKED_ENV_KEYS = new Set([
  'OFFICE_AUTH_TOKEN',
  'ANTIGRAVITY_CSRF_TOKEN',
  'ALLOWED_ORIGINS',
  'ALLOWED_HOSTS',
  'ALLOWED_WORKSPACES',
  'ENABLE_CUSTOM_CLI',
  'AGENT_PASS_ENV',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES',
  'DYLD_LIBRARY_PATH',
]);

const PROVIDER_ENV_RULES: Record<
  CliProviderInfo['id'],
  { exact: ReadonlySet<string>; prefixes: readonly string[] }
> = {
  claude: {
    exact: new Set([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'CLAUDE_CONFIG_DIR',
    ]),
    prefixes: ['ANTHROPIC_', 'CLAUDE_'],
  },
  gemini: {
    exact: new Set([
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ]),
    prefixes: ['GEMINI_'],
  },
  agy: {
    exact: new Set([
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GOOGLE_CLOUD_PROJECT',
      'GOOGLE_CLOUD_LOCATION',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ]),
    prefixes: ['AGY_', 'ANTIGRAVITY_', 'GEMINI_'],
  },
  codex: {
    exact: new Set(['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_ORG_ID', 'OPENAI_PROJECT']),
    prefixes: ['OPENAI_', 'CODEX_'],
  },
  aider: {
    exact: new Set([
      'OPENAI_API_KEY',
      'OPENAI_API_BASE',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'OPENROUTER_API_KEY',
      'DEEPSEEK_API_KEY',
      'OLLAMA_API_BASE',
      'OLLAMA_HOST',
    ]),
    prefixes: ['AIDER_'],
  },
  custom: {
    exact: new Set(['OLLAMA_HOST', 'OLLAMA_MODELS', 'LLM_USER_PATH']),
    prefixes: [],
  },
  demo: {
    exact: new Set(),
    prefixes: [],
  },
};

const UNTRUSTED_PATH_PREFIXES = ['/tmp', '/var/tmp', '/dev/shm'];

export function sanitizePathEnv(rawPath: string | undefined): string | undefined {
  if (!rawPath) return undefined;
  const safeSegments = rawPath
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter((seg) => {
      if (!seg || !path.isAbsolute(seg) || seg.includes('..')) return false;
      const resolved = path.resolve(seg);
      return !UNTRUSTED_PATH_PREFIXES.some(
        (prefix) => resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`)
      );
    });
  return safeSegments.length > 0 ? safeSegments.join(path.delimiter) : undefined;
}

export function buildSafeEnv(
  providerId: CliProviderInfo['id'],
  sourceEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const rules = PROVIDER_ENV_RULES[providerId] ?? PROVIDER_ENV_RULES.custom;
  const extraAllowed = new Set(
    (sourceEnv.AGENT_PASS_ENV || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const filtered: NodeJS.ProcessEnv = {
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };

  for (const [key, value] of Object.entries(sourceEnv)) {
    if (value === undefined) continue;
    if (ALWAYS_BLOCKED_ENV_KEYS.has(key)) continue;

    const allowed =
      COMMON_SAFE_ENV_KEYS.has(key) ||
      rules.exact.has(key) ||
      rules.prefixes.some((prefix) => key.startsWith(prefix)) ||
      extraAllowed.has(key);

    if (!allowed) continue;

    if (key === 'PATH') {
      const safePath = sanitizePathEnv(value);
      if (safePath) filtered.PATH = safePath;
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

export class AgentRunner {
  private running = new Map<string, RunningTask>();

  isRunning(agentId: string): boolean {
    return this.running.has(agentId);
  }

  getActivePids(): Set<number> {
    const pids = new Set<number>();
    for (const task of this.running.values()) {
      if (task.proc?.pid) pids.add(task.proc.pid);
    }
    return pids;
  }

  abort(agentId: string): boolean {
    const task = this.running.get(agentId);
    if (!task) return false;
    task.aborted = true;
    if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
    if (task.kind === 'process' && task.proc) {
      killProcessTree(task.proc, 'SIGTERM');
      const procRef = task.proc;
      setTimeout(() => {
        if (!procRef.killed && procRef.exitCode === null) {
          killProcessTree(procRef, 'SIGKILL');
        }
      }, 1500);
    }
    if (task.kind === 'demo' && task.timers) {
      for (const t of task.timers) clearTimeout(t);
    }
    this.running.delete(agentId);
    return true;
  }

  run(
    agent: AgentRecord,
    provider: CliProviderInfo,
    prompt: string,
    cwd: string,
    callbacks: RunnerCallbacks
  ): void {
    if (this.running.has(agent.id)) {
      this.abort(agent.id);
    }

    if (this.running.size >= MAX_CONCURRENT_TASKS) {
      callbacks.onChunk(
        `\n[Limite atingido]: máximo de ${MAX_CONCURRENT_TASKS} tarefas simultâneas em execução.\n`
      );
      callbacks.onDone('error');
      return;
    }

    if (provider.id === 'demo' || (!provider.installed && provider.id !== 'custom')) {
      this.runDemoSimulation(agent, provider, prompt, cwd, callbacks);
      return;
    }

    const safeCwd = validateWorkspacePath(cwd, '');
    if (!safeCwd) {
      callbacks.onChunk(`\n[Erro]: diretório de trabalho inválido ou não permitido: ${cwd}\n`);
      callbacks.onDone('error');
      return;
    }

    let command: string;
    let args: string[];
    try {
      const inv = buildCliInvocation(provider, prompt, agent.customCommand);
      command = inv.command;
      args = inv.args;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onChunk(`\n[Bloqueado por segurança]: ${msg}\n`);
      callbacks.onDone('error');
      return;
    }

    callbacks.onActivity(`Executando ${provider.name}...`);

    let proc: ChildProcess;
    try {
      proc = spawn(command, args, {
        cwd: safeCwd,
        shell: false,
        detached: true,
        env: buildSafeEnv(provider.id),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onChunk(`\n[Erro ao iniciar ${provider.name}]: ${msg}\n`);
      callbacks.onDone('error');
      return;
    }

    const timeoutTimer = setTimeout(() => {
      if (!this.running.has(agent.id)) return;
      callbacks.onChunk('\n[Timeout]: execução encerrada após 10 minutos.\n');
      this.abort(agent.id);
      callbacks.onDone('error');
    }, TASK_TIMEOUT_MS);

    const task: RunningTask = {
      kind: 'process',
      proc,
      timeoutTimer,
      aborted: false,
    };
    this.running.set(agent.id, task);

    let hasOutput = false;
    let totalBytes = 0;
    let truncatedNoticeSent = false;

    const handleData = (data: Buffer) => {
      hasOutput = true;
      if (totalBytes >= MAX_OUTPUT_BYTES) {
        if (!truncatedNoticeSent) {
          truncatedNoticeSent = true;
          callbacks.onChunk('\n[Saída truncada: limite de 256 KB atingido]\n');
        }
        return;
      }
      totalBytes += data.length;
      const text = data.toString('utf8');
      const inferred = inferActivityFromOutput(text);
      if (inferred) {
        callbacks.onActivity(inferred);
      }
      callbacks.onChunk(text, inferred);
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    proc.on('error', (err) => {
      if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
      this.running.delete(agent.id);
      if (task.aborted) {
        callbacks.onDone('aborted');
        return;
      }
      callbacks.onChunk(`\n[Erro de execução]: ${err.message}\n`);
      callbacks.onDone('error');
    });

    proc.on('close', (code) => {
      if (task.timeoutTimer) clearTimeout(task.timeoutTimer);
      this.running.delete(agent.id);
      if (task.aborted) {
        callbacks.onDone('aborted');
        return;
      }
      if (!hasOutput) {
        callbacks.onChunk(`(Processo finalizado com código ${code ?? 0} sem saída de texto.)`);
      }
      callbacks.onDone(code === 0 ? 'done' : 'error');
    });
  }

  private runDemoSimulation(
    agent: AgentRecord,
    provider: CliProviderInfo,
    prompt: string,
    cwd: string,
    callbacks: RunnerCallbacks
  ): void {
    const timers: NodeJS.Timeout[] = [];
    const task: RunningTask = { kind: 'demo', timers, aborted: false };
    this.running.set(agent.id, task);

    const isFallback = provider.id !== 'demo';
    const header = isFallback
      ? `> ⚠️ **${provider.name}** (\`${provider.binary}\`) não foi encontrado no PATH. Rodando em **Modo Simulação**!\n\n`
      : '';

    const isMeeting = prompt.startsWith('[REUNIÃO AI OFFICE]');
    const steps: Array<{ delay: number; activity: string; chunk: string }> = isMeeting
      ? this.buildDemoMeetingSteps(agent, prompt, header)
      : [
          {
            delay: 450,
            activity: 'Lendo workspace...',
            chunk: `${header}📂 Inspecionando diretório \`${cwd}\`...\n`,
          },
          {
            delay: 1400,
            activity: 'Analisando tarefa...',
            chunk: `🧠 Entendi seu pedido: _"${prompt}"_\n\n`,
          },
          {
            delay: 2500,
            activity: 'Editando código...',
            chunk: `⚙️ Como **${agent.roleTitle}**, organizei os próximos passos:\n1. Verificar arquivos relevantes no workspace.\n2. Aplicar as mudanças solicitadas com segurança.\n3. Validar o resultado final.\n\n`,
          },
          {
            delay: 3800,
            activity: 'Validando resultado...',
            chunk: `✅ Tudo pronto por aqui! Vou levantar um pouco para pegar um café ☕.`,
          },
        ];

    for (const step of steps) {
      const timer = setTimeout(() => {
        if (task.aborted) return;
        callbacks.onActivity(step.activity);
        callbacks.onChunk(step.chunk, step.activity);
      }, step.delay);
      timers.push(timer);
    }

    const finalDelay = isMeeting ? 2600 : 4500;
    const doneTimer = setTimeout(() => {
      if (task.aborted) return;
      this.running.delete(agent.id);
      callbacks.onDone('done');
    }, finalDelay);
    timers.push(doneTimer);
  }

  private buildDemoMeetingSteps(
    agent: AgentRecord,
    prompt: string,
    header: string
  ): Array<{ delay: number; activity: string; chunk: string }> {
    // Extract the latest user prompt and previous agent contribution from the transcript
    const userMatches = [...prompt.matchAll(/^\[Você\]:\s*(.+)$/gm)];
    const lastUserLine = userMatches[userMatches.length - 1]?.[1]?.trim() || 'o tema da reunião';
    const shortUser =
      lastUserLine.length > 100 ? `${lastUserLine.slice(0, 99)}…` : lastUserLine;

    const agentMatches = [...prompt.matchAll(/^\[([^\]\n]+)\]:\s*(.+)$/gm)].filter(
      (m) =>
        m[1] !== 'Você' &&
        m[1] !== agent.name &&
        !m[1].startsWith(`${agent.name} (`)
    );
    const prevSpeaker = agentMatches[agentMatches.length - 1]?.[1]?.trim();

    const opening = prevSpeaker
      ? `${header}Complementando o ponto de **${prevSpeaker}**, olhando pelo ângulo de **${agent.roleTitle}**:\n\n`
      : `${header}Analisando o pedido _"${shortUser}"_ como **${agent.roleTitle}**:\n\n`;

    const body = prevSpeaker
      ? `- Concordo com a direção geral e sugiro alinharmos testes e edge cases antes de fechar.\n- Posso ficar responsável pela validação prática no workspace assim que decidirmos.`
      : `- Vale dividir a solução em etapas pequenas e verificáveis.\n- Quero ouvir a visão dos colegas aqui na mesa antes de partirmos para a implementação.`;

    return [
      {
        delay: 400,
        activity: 'Na reunião: lendo histórico...',
        chunk: opening,
      },
      {
        delay: 1400,
        activity: 'Na reunião: respondendo...',
        chunk: body,
      },
    ];
  }
}

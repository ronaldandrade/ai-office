import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { buildCliInvocation } from './cliRegistry.ts';
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

function buildSafeEnv(providerId: CliProviderInfo['id']): NodeJS.ProcessEnv {
  if (providerId === 'custom') {
    const allowKeys = [
      'PATH',
      'HOME',
      'USER',
      'LANG',
      'LC_ALL',
      'TERM',
      'OLLAMA_HOST',
      'TMPDIR',
    ];
    const filtered: NodeJS.ProcessEnv = {
      FORCE_COLOR: '0',
      NO_COLOR: '1',
    };
    for (const k of allowKeys) {
      if (process.env[k] !== undefined) filtered[k] = process.env[k];
    }
    return filtered;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  };
  delete env.OFFICE_AUTH_TOKEN;
  return env;
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

    let safeCwd = process.cwd();
    try {
      if (fs.statSync(cwd).isDirectory()) {
        safeCwd = cwd;
      }
    } catch {
      callbacks.onChunk(`\n[Erro]: diretório de trabalho inválido: ${cwd}\n`);
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

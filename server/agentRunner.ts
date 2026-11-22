import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { buildCliInvocation } from './cliRegistry.ts';
import type { AgentRecord, CliProviderInfo } from './types.ts';

interface RunningTask {
  kind: 'process' | 'demo';
  proc?: ChildProcess;
  timers?: NodeJS.Timeout[];
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
    if (task.kind === 'process' && task.proc) {
      task.proc.kill('SIGTERM');
      setTimeout(() => {
        if (task.proc && !task.proc.killed) {
          task.proc.kill('SIGKILL');
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

    if (provider.id === 'demo' || (!provider.installed && provider.id !== 'custom')) {
      this.runDemoSimulation(agent, provider, prompt, cwd, callbacks);
      return;
    }

    const safeCwd = fs.existsSync(cwd) ? cwd : process.cwd();
    const { command, args, shell } = buildCliInvocation(
      provider,
      prompt,
      agent.customCommand
    );

    callbacks.onActivity(`Executando ${provider.name}...`);

    let proc: ChildProcess;
    try {
      proc = spawn(command, args, {
        cwd: safeCwd,
        shell,
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      callbacks.onChunk(`\n[Erro ao iniciar ${provider.name}]: ${msg}\n`);
      callbacks.onDone('error');
      return;
    }

    const task: RunningTask = { kind: 'process', proc, aborted: false };
    this.running.set(agent.id, task);

    let hasOutput = false;

    const handleData = (data: Buffer) => {
      const text = data.toString('utf8');
      hasOutput = true;
      const inferred = inferActivityFromOutput(text);
      if (inferred) {
        callbacks.onActivity(inferred);
      }
      callbacks.onChunk(text, inferred);
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    proc.on('error', (err) => {
      this.running.delete(agent.id);
      if (task.aborted) {
        callbacks.onDone('aborted');
        return;
      }
      callbacks.onChunk(`\n[Erro de execução]: ${err.message}\n`);
      callbacks.onDone('error');
    });

    proc.on('close', (code) => {
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

    const steps: Array<{ delay: number; activity: string; chunk: string }> = [
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

    const doneTimer = setTimeout(() => {
      if (task.aborted) return;
      this.running.delete(agent.id);
      callbacks.onDone('done');
    }, 4500);
    timers.push(doneTimer);
  }
}

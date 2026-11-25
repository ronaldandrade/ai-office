import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderId } from './types.ts';

export interface DetectedTerminalAgent {
  pid: number;
  provider: ProviderId;
  cwd: string | null;
  projectName: string;
  busy: boolean;
  activityHint?: string;
}

interface RawProcess {
  pid: number;
  ppid: number;
  pcpu: number;
  comm: string;
  args: string;
}

interface ProcActivitySample {
  cpuTicks: number;
  ioBytes: number;
  ts: number;
}

const KNOWN_BINARIES: Array<{ provider: ProviderId; names: string[] }> = [
  { provider: 'claude', names: ['claude'] },
  { provider: 'agy', names: ['agy'] },
  { provider: 'gemini', names: ['gemini'] },
  { provider: 'codex', names: ['codex'] },
  { provider: 'aider', names: ['aider'] },
];

const ACTIVE_TOOL_COMMANDS = new Set([
  'bash',
  'sh',
  'zsh',
  'git',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'cargo',
  'go',
  'python',
  'python3',
  'pytest',
  'rg',
  'grep',
  'find',
  'make',
  'docker',
  'tsc',
  'vite',
  'tsx',
]);

function matchProvider(proc: RawProcess): ProviderId | null {
  const comm = proc.comm.toLowerCase();
  const argsLower = proc.args.toLowerCase();

  if (
    comm === 'grep' ||
    comm === 'rg' ||
    comm === 'ps' ||
    argsLower.includes('ai-office') ||
    argsLower.includes('tsx watch')
  ) {
    return null;
  }

  for (const entry of KNOWN_BINARIES) {
    if (entry.names.includes(comm)) {
      return entry.provider;
    }
  }

  if (comm === 'node' || comm === 'bun' || comm.startsWith('python')) {
    const tokens = argsLower.split(/\s+/);
    const scriptToken = tokens[1] || '';
    const base = path.basename(scriptToken);
    for (const entry of KNOWN_BINARIES) {
      if (entry.names.includes(base)) {
        return entry.provider;
      }
    }
  }

  return null;
}

function readProcCwd(pid: number): string | null {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

/**
 * Reads utime + stime (in kernel clock ticks) from /proc/<pid>/stat.
 */
function readProcCpuTicks(pid: number): number {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // comm field is wrapped in parentheses and may contain spaces
    const closeParen = stat.lastIndexOf(')');
    if (closeParen === -1) return 0;
    const fields = stat.slice(closeParen + 2).split(' ');
    // fields[11] = utime (field 14), fields[12] = stime (field 15)
    const utime = Number(fields[11]) || 0;
    const stime = Number(fields[12]) || 0;
    return utime + stime;
  } catch {
    return 0;
  }
}

/**
 * Reads total bytes read+written (rchar + wchar) from /proc/<pid>/io.
 */
function readProcIoBytes(pid: number): number {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/io`, 'utf8');
    let total = 0;
    for (const line of raw.split('\n')) {
      if (line.startsWith('wchar:') || line.startsWith('write_bytes:')) {
        total += Number(line.split(':')[1]?.trim()) || 0;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

function collectSelfSubtreeExclusions(
  allProcs: RawProcess[]
): Set<number> {
  const byPid = new Map(allProcs.map((p) => [p.pid, p]));
  const excluded = new Set<number>();

  // Walk up from our own server PID until we hit a known AI CLI or init
  let cur: number | undefined = process.pid;
  let hops = 0;
  while (cur && cur > 1 && hops < 12) {
    const proc = byPid.get(cur);
    if (!proc) break;
    if (matchProvider(proc)) {
      // Stop before the AI CLI itself so we still track the CLI,
      // but exclude the ai-office launcher chain beneath it!
      break;
    }
    excluded.add(cur);
    cur = proc.ppid;
    hops++;
  }

  // Also exclude any process whose command line belongs to ai-office
  for (const p of allProcs) {
    if (p.args.toLowerCase().includes('ai-office')) {
      excluded.add(p.pid);
    }
  }

  return excluded;
}

function collectDescendants(
  rootPid: number,
  childrenByPpid: Map<number, RawProcess[]>,
  excluded: Set<number>,
  maxDepth = 4
): RawProcess[] {
  const result: RawProcess[] = [];
  const queue: Array<{ pid: number; depth: number }> = [{ pid: rootPid, depth: 0 }];

  while (queue.length > 0) {
    const { pid, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    const children = childrenByPpid.get(pid) || [];
    for (const child of children) {
      if (excluded.has(child.pid)) continue;
      result.push(child);
      queue.push({ pid: child.pid, depth: depth + 1 });
    }
  }

  return result;
}

export class TerminalWatcher {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private busyCooldownUntil = new Map<number, number>();
  private lastSamples = new Map<number, ProcActivitySample>();
  private getIgnoredPids: () => Set<number>;
  private onUpdate: (detected: DetectedTerminalAgent[]) => void;

  constructor(
    getIgnoredPids: () => Set<number>,
    onUpdate: (detected: DetectedTerminalAgent[]) => void
  ) {
    this.getIgnoredPids = getIgnoredPids;
    this.onUpdate = onUpdate;
  }

  start(intervalMs = 1500): void {
    this.scan();
    this.timer = setInterval(() => this.scan(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  scan(): void {
    if (this.inFlight) return;
    this.inFlight = true;

    const uid = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().uid;
    const psArgs =
      uid >= 0
        ? ['-u', String(uid), '-o', 'pid=,ppid=,pcpu=,comm=,args=']
        : ['-eo', 'pid=,ppid=,pcpu=,comm=,args='];

    execFile(
      'ps',
      psArgs,
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        this.inFlight = false;
        if (err || !stdout) return;

        const ignored = this.getIgnoredPids();
        const allProcs: RawProcess[] = [];

        for (const rawLine of stdout.split('\n')) {
          const line = rawLine.trim();
          if (!line) continue;
          const m = line.match(/^(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/);
          if (!m) continue;
          allProcs.push({
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pcpu: Number(m[3].replace(',', '.')),
            comm: m[4],
            args: m[5],
          });
        }

        const selfExcluded = collectSelfSubtreeExclusions(allProcs);

        const childrenByPpid = new Map<number, RawProcess[]>();
        for (const p of allProcs) {
          const list = childrenByPpid.get(p.ppid) || [];
          list.push(p);
          childrenByPpid.set(p.ppid, list);
        }

        const matchedPids = new Set<number>();
        const candidates: Array<{ proc: RawProcess; provider: ProviderId }> = [];

        for (const p of allProcs) {
          if (ignored.has(p.pid) || ignored.has(p.ppid)) continue;
          if (selfExcluded.has(p.pid)) continue;
          const provider = matchProvider(p);
          if (provider) {
            matchedPids.add(p.pid);
            candidates.push({ proc: p, provider });
          }
        }

        const now = Date.now();
        const detected: DetectedTerminalAgent[] = [];

        for (const { proc, provider } of candidates) {
          if (matchedPids.has(proc.ppid)) continue;

          const cwd = readProcCwd(proc.pid);
          const projectName = cwd ? path.basename(cwd) || cwd : 'workspace';
          const descendants = collectDescendants(proc.pid, childrenByPpid, selfExcluded);

          // Look for an actively executing tool subprocess (ignoring ai-office itself & idle helpers)
          const activeChild = descendants.find((c) => {
            const name = c.comm.toLowerCase();
            if (name === 'sleep' || name === 'cat' || name === 'ps') return false;
            return ACTIVE_TOOL_COMMANDS.has(name);
          });

          // Measure instantaneous CPU ticks & write I/O delta across the process + its descendants
          let totalCpuTicks = readProcCpuTicks(proc.pid);
          let totalIoBytes = readProcIoBytes(proc.pid);
          for (const d of descendants) {
            totalCpuTicks += readProcCpuTicks(d.pid);
            totalIoBytes += readProcIoBytes(d.pid);
          }

          const prev = this.lastSamples.get(proc.pid);
          this.lastSamples.set(proc.pid, {
            cpuTicks: totalCpuTicks,
            ioBytes: totalIoBytes,
            ts: now,
          });

          let instantBusy = false;
          if (prev && now > prev.ts) {
            const deltaTicks = Math.max(0, totalCpuTicks - prev.cpuTicks);
            const deltaIo = Math.max(0, totalIoBytes - prev.ioBytes);
            // ~5 kernel ticks (~50ms CPU in 1.5s) or >= 2KB written indicates active work/streaming
            if (deltaTicks >= 5 || deltaIo >= 2048) {
              instantBusy = true;
            }
          }

          const rawBusy = Boolean(activeChild) || instantBusy;
          if (rawBusy) {
            this.busyCooldownUntil.set(proc.pid, now + 5000);
          }

          const busy = rawBusy || (this.busyCooldownUntil.get(proc.pid) ?? 0) > now;
          let activityHint: string | undefined;
          if (activeChild) {
            activityHint = `Terminal (${projectName}): ${activeChild.comm}`;
          } else if (busy) {
            activityHint = `Trabalhando em ${projectName}...`;
          }

          detected.push({
            pid: proc.pid,
            provider,
            cwd,
            projectName,
            busy,
            activityHint,
          });
        }

        const livePids = new Set(detected.map((d) => d.pid));
        for (const pid of this.busyCooldownUntil.keys()) {
          if (!livePids.has(pid)) this.busyCooldownUntil.delete(pid);
        }
        for (const pid of this.lastSamples.keys()) {
          if (!livePids.has(pid)) this.lastSamples.delete(pid);
        }

        this.onUpdate(detected);
      }
    );
  }
}

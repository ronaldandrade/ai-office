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

const KNOWN_BINARIES: Array<{ provider: ProviderId; names: string[] }> = [
  { provider: 'claude', names: ['claude'] },
  { provider: 'agy', names: ['agy'] },
  { provider: 'gemini', names: ['gemini'] },
  { provider: 'codex', names: ['codex'] },
  { provider: 'aider', names: ['aider'] },
];

function matchProvider(proc: RawProcess): ProviderId | null {
  const comm = proc.comm.toLowerCase();
  const argsLower = proc.args.toLowerCase();

  // Ignore shells, grep, editors, or ai-office itself
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

  // Handle node/python wrappers (e.g. `node /path/to/gemini` or `node .../claude`)
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

export class TerminalWatcher {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private busyCooldownUntil = new Map<number, number>();
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

        // Index children by ppid to detect active tool/command execution
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
          const provider = matchProvider(p);
          if (provider) {
            matchedPids.add(p.pid);
            candidates.push({ proc: p, provider });
          }
        }

        // Deduplicate nested child wrapper processes (keep top-most matched parent)
        const now = Date.now();
        const detected: DetectedTerminalAgent[] = [];

        for (const { proc, provider } of candidates) {
          if (matchedPids.has(proc.ppid)) continue;

          const cwd = readProcCwd(proc.pid);
          const projectName = cwd ? path.basename(cwd) || cwd : 'workspace';
          const children = childrenByPpid.get(proc.pid) || [];
          const activeChild = children.find(
            (c) =>
              c.comm !== 'sleep' &&
              c.comm !== 'cat' &&
              !c.comm.startsWith('node') &&
              (c.pcpu > 0.2 || c.comm === 'bash' || c.comm === 'sh' || c.comm === 'git' || c.comm === 'npm')
          );

          const rawBusy = proc.pcpu >= 2.2 || Boolean(activeChild);
          if (rawBusy) {
            this.busyCooldownUntil.set(proc.pid, now + 4500);
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

        // Clean stale cooldown entries
        const livePids = new Set(detected.map((d) => d.pid));
        for (const pid of this.busyCooldownUntil.keys()) {
          if (!livePids.has(pid)) this.busyCooldownUntil.delete(pid);
        }

        this.onUpdate(detected);
      }
    );
  }
}

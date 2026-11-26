import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isPathInsideRoot } from './security.ts';
import type { AgentRecord, AgentSummary } from './types.ts';

const MAX_TAIL_BYTES = 256 * 1024;
const MAX_HEAD_BYTES = 32 * 1024;
const MAX_ANTIGRAVITY_CANDIDATES = 20;

const TOOL_PATH_ARG_KEYS = [
  'Path',
  'path',
  'Cwd',
  'cwd',
  'DirectoryPath',
  'SearchPath',
  'TargetFile',
  'AbsolutePath',
  'ScriptPath',
  'filePath',
  'dirPath',
  'rootPath',
];

async function readRangeLinesSafe(
  filePath: string,
  allowedRoot: string,
  mode: 'head' | 'tail'
): Promise<string[]> {
  try {
    const lstat = await fsp.lstat(filePath);
    if (lstat.isSymbolicLink() || !lstat.isFile()) return [];

    const realRoot = await fsp.realpath(allowedRoot);
    const realFile = await fsp.realpath(filePath);
    if (!isPathInsideRoot(realFile, realRoot)) return [];

    const size = lstat.size;
    if (size === 0) return [];

    const maxBytes = mode === 'tail' ? MAX_TAIL_BYTES : MAX_HEAD_BYTES;
    const start = mode === 'tail' ? Math.max(0, size - maxBytes) : 0;
    const len = mode === 'tail' ? size - start : Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    const handle = await fsp.open(realFile, 'r');
    try {
      await handle.read(buf, 0, len, start);
    } finally {
      await handle.close();
    }

    const text = buf.toString('utf8');
    const lines = text.split('\n');
    if (mode === 'tail' && start > 0 && lines.length > 1) lines.shift();
    if (mode === 'head' && len < size && lines.length > 1) lines.pop();
    return lines.filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

async function readTailLinesSafe(filePath: string, allowedRoot: string): Promise<string[]> {
  return readRangeLinesSafe(filePath, allowedRoot, 'tail');
}

async function readHeadLinesSafe(filePath: string, allowedRoot: string): Promise<string[]> {
  return readRangeLinesSafe(filePath, allowedRoot, 'head');
}

function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

async function findLatestJsonlInDir(dirPath: string): Promise<string | null> {
  try {
    const entries = await fsp.readdir(dirPath);
    const jsonlFiles = entries.filter((f) => f.endsWith('.jsonl'));
    const stats = await Promise.all(
      jsonlFiles.map(async (f) => {
        const full = path.join(dirPath, f);
        try {
          const st = await fsp.lstat(full);
          if (st.isSymbolicLink() || !st.isFile()) return null;
          return { full, mtime: st.mtimeMs };
        } catch {
          return null;
        }
      })
    );
    const valid = stats
      .filter((x): x is { full: string; mtime: number } => Boolean(x))
      .sort((a, b) => b.mtime - a.mtime);
    return valid[0]?.full ?? null;
  } catch {
    return null;
  }
}

export async function readClaudeSummary(
  cwd: string,
  projectsRoot = path.join(os.homedir(), '.claude', 'projects')
): Promise<AgentSummary | null> {
  const encoded = encodeClaudeProjectDir(cwd);
  const projectDir = path.join(projectsRoot, encoded);

  // Only read transcripts belonging strictly to the agent's own workspace directory
  const targetFile = await findLatestJsonlInDir(projectDir);
  if (!targetFile) return null;

  const lines = await readTailLinesSafe(targetFile, projectsRoot);
  let summary = '';
  let timestamp = 0;
  let lastPrompt: string | undefined;
  const toolsUsed = new Set<string>();

  for (let i = lines.length - 1; i >= 0; i--) {
    let entry: {
      type?: string;
      timestamp?: string;
      message?: {
        content?: string | Array<{ type?: string; text?: string; name?: string }>;
      };
    };
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }

    if (entry.type === 'assistant' && Array.isArray(entry.message?.content)) {
      for (const block of entry.message.content) {
        if (block.type === 'tool_use' && block.name && toolsUsed.size < 6) {
          toolsUsed.add(block.name);
        }
      }
      if (!summary) {
        const textParts = entry.message.content
          .filter((b) => b.type === 'text' && typeof b.text === 'string' && b.text.trim())
          .map((b) => b.text!.trim());
        if (textParts.length > 0) {
          summary = textParts.join('\n\n');
          timestamp = entry.timestamp ? Date.parse(entry.timestamp) : Date.now();
        }
      }
    } else if (
      entry.type === 'user' &&
      !lastPrompt &&
      typeof entry.message?.content === 'string' &&
      entry.message.content.trim()
    ) {
      lastPrompt = entry.message.content.trim();
      if (summary) break;
    }
  }

  if (!summary) return null;

  return {
    summary,
    lastPrompt,
    timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now(),
    source: 'Claude Code (Terminal)',
    toolsUsed: Array.from(toolsUsed),
    sessionFile: path.basename(targetFile),
  };
}

function unwrapPossibleJsonString(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        value = parsed.trim();
      }
    } catch {
      // keep raw value
    }
  }
  return value || null;
}

interface AntigravityTranscriptEntry {
  type?: string;
  source?: string;
  content?: string;
  created_at?: string;
  cwd?: unknown;
  workspace?: unknown;
  working_directory?: unknown;
  workingDirectory?: unknown;
  workspaces?: unknown;
  tool_calls?: Array<{
    name?: string;
    args?: Record<string, unknown>;
    arguments?: Record<string, unknown>;
  }>;
}

function extractPathsFromEntry(entry: AntigravityTranscriptEntry): string[] {
  const found: string[] = [];
  const pushIfAbsolute = (raw: unknown) => {
    const val = unwrapPossibleJsonString(raw);
    if (val && path.isAbsolute(val)) {
      found.push(val);
    }
  };

  pushIfAbsolute(entry.cwd);
  pushIfAbsolute(entry.workspace);
  pushIfAbsolute(entry.working_directory);
  pushIfAbsolute(entry.workingDirectory);
  if (Array.isArray(entry.workspaces)) {
    for (const ws of entry.workspaces) pushIfAbsolute(ws);
  }

  if (Array.isArray(entry.tool_calls)) {
    for (const tc of entry.tool_calls) {
      const argObj =
        tc.args && typeof tc.args === 'object'
          ? tc.args
          : tc.arguments && typeof tc.arguments === 'object'
            ? tc.arguments
            : undefined;
      if (!argObj) continue;
      for (const key of TOOL_PATH_ARG_KEYS) {
        if (key in argObj) {
          pushIfAbsolute(argObj[key]);
        }
      }
    }
  }

  return found;
}

function entryMatchesWorkspace(
  entry: AntigravityTranscriptEntry,
  targetCwds: string[],
  ignoredRoot: string
): boolean {
  const paths = extractPathsFromEntry(entry);
  for (const rawPath of paths) {
    const normalized = path.resolve(rawPath);
    if (isPathInsideRoot(normalized, ignoredRoot)) continue;
    if (targetCwds.some((cwd) => isPathInsideRoot(normalized, cwd))) {
      return true;
    }
  }
  return false;
}

export async function readAntigravitySummary(
  cwd: string,
  brainRoot = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain')
): Promise<AgentSummary | null> {
  if (!cwd || !cwd.trim()) return null;

  const targetCwds = [path.resolve(cwd)];
  try {
    const realCwd = await fsp.realpath(cwd);
    if (!targetCwds.includes(realCwd)) targetCwds.push(realCwd);
  } catch {
    // use resolved path if realpath fails
  }

  const realBrainRoot = await fsp.realpath(brainRoot).catch(() => path.resolve(brainRoot));

  let ids: string[];
  try {
    ids = await fsp.readdir(brainRoot);
  } catch {
    return null;
  }

  const candidateStats = await Promise.all(
    ids.map(async (id) => {
      if (!id || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
        return null;
      }
      const convDir = path.join(brainRoot, id);
      const file = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const dirStat = await fsp.lstat(convDir);
        if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
        const st = await fsp.lstat(file);
        if (st.isSymbolicLink() || !st.isFile()) return null;
        return { file, mtime: st.mtimeMs };
      } catch {
        return null;
      }
    })
  );

  const candidates = candidateStats
    .filter((x): x is { file: string; mtime: number } => Boolean(x))
    .sort((a, b) => b.mtime - a.mtime);

  for (const cand of candidates.slice(0, MAX_ANTIGRAVITY_CANDIDATES)) {
    const lines = await readTailLinesSafe(cand.file, brainRoot);
    let summary = '';
    let timestamp = 0;
    let lastPrompt: string | undefined;
    const toolsUsed = new Set<string>();
    let hasUserExplicit = false;
    let matchesCwd = false;

    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: AntigravityTranscriptEntry;
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
      }

      if (!matchesCwd && entryMatchesWorkspace(entry, targetCwds, realBrainRoot)) {
        matchesCwd = true;
      }

      if (entry.type === 'PLANNER_RESPONSE') {
        if (Array.isArray(entry.tool_calls)) {
          for (const tc of entry.tool_calls) {
            if (tc.name && toolsUsed.size < 6) toolsUsed.add(tc.name);
          }
        }
        if (!summary && typeof entry.content === 'string' && entry.content.trim()) {
          summary = entry.content.trim();
          timestamp = entry.created_at ? Date.parse(entry.created_at) : cand.mtime;
        }
      } else if (entry.type === 'USER_INPUT' && entry.source === 'USER_EXPLICIT') {
        hasUserExplicit = true;
        if (!lastPrompt && typeof entry.content === 'string' && entry.content.trim()) {
          lastPrompt = entry.content.trim();
        }
      }
    }

    if (!matchesCwd && summary && hasUserExplicit) {
      const headLines = await readHeadLinesSafe(cand.file, brainRoot);
      for (const line of headLines) {
        try {
          const entry = JSON.parse(line) as AntigravityTranscriptEntry;
          if (entryMatchesWorkspace(entry, targetCwds, realBrainRoot)) {
            matchesCwd = true;
            break;
          }
        } catch {
          // ignore malformed line
        }
      }
    }

    if (summary && hasUserExplicit && matchesCwd) {
      return {
        summary,
        lastPrompt,
        timestamp: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : cand.mtime,
        source: 'Antigravity CLI (Terminal)',
        toolsUsed: Array.from(toolsUsed),
        sessionFile: path.basename(path.dirname(path.dirname(path.dirname(cand.file)))),
      };
    }
  }

  return null;
}

export async function readLatestAgentSummary(
  agent: AgentRecord
): Promise<AgentSummary | null> {
  let webSummary: AgentSummary | null = null;
  for (let i = agent.messages.length - 1; i >= 0; i--) {
    const msg = agent.messages[i];
    if (msg.role === 'assistant' && msg.content.trim()) {
      const prevUser = agent.messages
        .slice(0, i)
        .reverse()
        .find((m) => m.role === 'user');
      webSummary = {
        summary: msg.content.trim(),
        lastPrompt: prevUser?.content,
        timestamp: msg.timestamp,
        source: 'AI Office (Web)',
        toolsUsed: [],
      };
      break;
    }
  }

  let diskSummary: AgentSummary | null = null;
  if (agent.provider === 'claude') {
    diskSummary = await readClaudeSummary(agent.cwd);
  } else if (agent.provider === 'agy') {
    diskSummary = await readAntigravitySummary(agent.cwd);
  }

  if (webSummary && diskSummary) {
    return webSummary.timestamp >= diskSummary.timestamp ? webSummary : diskSummary;
  }
  return diskSummary || webSummary;
}

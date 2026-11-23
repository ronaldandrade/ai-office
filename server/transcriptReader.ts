import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentRecord, AgentSummary } from './types.ts';

const MAX_TAIL_BYTES = 256 * 1024;

function readTailLines(filePath: string): string[] {
  try {
    const stat = fs.statSync(filePath);
    const size = stat.size;
    if (size === 0) return [];
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const len = size - start;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, len, start);
    } finally {
      fs.closeSync(fd);
    }
    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // Drop possibly truncated first line if we started mid-file
    if (start > 0 && lines.length > 1) lines.shift();
    return lines.filter((l) => l.trim().length > 0);
  } catch {
    return [];
  }
}

function encodeClaudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function findLatestJsonlInDir(dirPath: string): string | null {
  try {
    if (!fs.existsSync(dirPath)) return null;
    const files = fs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => {
        const full = path.join(dirPath, f);
        try {
          return { full, mtime: fs.statSync(full).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((x): x is { full: string; mtime: number } => Boolean(x))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.full ?? null;
  } catch {
    return null;
  }
}

function readClaudeSummary(cwd: string): AgentSummary | null {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(projectsRoot)) return null;

  const encoded = encodeClaudeProjectDir(cwd);
  let targetFile = findLatestJsonlInDir(path.join(projectsRoot, encoded));

  // Fallback: newest jsonl across any project dir if exact cwd folder doesn't exist
  if (!targetFile) {
    try {
      const dirs = fs
        .readdirSync(projectsRoot)
        .map((d) => {
          const full = path.join(projectsRoot, d);
          try {
            const st = fs.statSync(full);
            return st.isDirectory() ? { full, mtime: st.mtimeMs } : null;
          } catch {
            return null;
          }
        })
        .filter((x): x is { full: string; mtime: number } => Boolean(x))
        .sort((a, b) => b.mtime - a.mtime);

      for (const d of dirs.slice(0, 5)) {
        const found = findLatestJsonlInDir(d.full);
        if (found) {
          targetFile = found;
          break;
        }
      }
    } catch {
      return null;
    }
  }

  if (!targetFile) return null;

  const lines = readTailLines(targetFile);
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

function readAntigravitySummary(): AgentSummary | null {
  const brainRoot = path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  if (!fs.existsSync(brainRoot)) return null;

  let candidates: Array<{ file: string; mtime: number }> = [];
  try {
    for (const id of fs.readdirSync(brainRoot)) {
      const file = path.join(brainRoot, id, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(file)) {
        try {
          candidates.push({ file, mtime: fs.statSync(file).mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    return null;
  }

  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const cand of candidates.slice(0, 6)) {
    const lines = readTailLines(cand.file);
    let summary = '';
    let timestamp = 0;
    let lastPrompt: string | undefined;
    const toolsUsed = new Set<string>();
    let hasUserExplicit = false;

    for (let i = lines.length - 1; i >= 0; i--) {
      let entry: {
        type?: string;
        source?: string;
        content?: string;
        created_at?: string;
        tool_calls?: Array<{ name?: string }>;
      };
      try {
        entry = JSON.parse(lines[i]);
      } catch {
        continue;
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
        if (summary) break;
      }
    }

    if (summary && hasUserExplicit) {
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

export function readLatestAgentSummary(agent: AgentRecord): AgentSummary | null {
  // Check web chat messages first if any completed response exists
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
    diskSummary = readClaudeSummary(agent.cwd);
  } else if (agent.provider === 'agy') {
    diskSummary = readAntigravitySummary();
  }

  if (webSummary && diskSummary) {
    return webSummary.timestamp >= diskSummary.timestamp ? webSummary : diskSummary;
  }
  return diskSummary || webSummary;
}

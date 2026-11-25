import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import type { AgentAppearance, AgentRecord, ProviderId } from './types.ts';

export const ALLOWED_ORIGINS = new Set(
  (
    process.env.ALLOWED_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const VALID_PROVIDERS = new Set<ProviderId>([
  'claude',
  'gemini',
  'codex',
  'agy',
  'aider',
  'custom',
  'demo',
]);

const VALID_ACCESSORIES = new Set<NonNullable<AgentAppearance['accessory']>>([
  'glasses',
  'headphones',
  'cap',
  'none',
]);

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function initSessionToken(tokenFilePath: string): string {
  const token =
    process.env.OFFICE_AUTH_TOKEN?.trim() ||
    crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(tokenFilePath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.chmodSync(tokenFilePath, 0o600);
  } catch (err) {
    console.error('Failed to write session token file:', err);
  }
  return token;
}

export function safeCompareToken(provided: string | undefined, expected: string): boolean {
  if (!provided || typeof provided !== 'string') return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return undefined;
}

export function extractRequestToken(req: IncomingMessage): string | undefined {
  const headerToken = req.headers['x-office-token'];
  if (typeof headerToken === 'string' && headerToken.trim()) {
    return headerToken.trim();
  }
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  const cookieToken = parseCookie(req.headers.cookie, 'office_token');
  if (cookieToken) return cookieToken;

  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      const queryToken = parsed.searchParams.get('token');
      if (queryToken) return queryToken;
    } catch {
      // ignore malformed URL
    }
  }
  return undefined;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

export function isSameSiteBootstrapRequest(req: IncomingMessage): boolean {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (typeof secFetchSite === 'string' && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false;
  }
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    return false;
  }
  const referer = req.headers.referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!isAllowedOrigin(refOrigin)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export function sanitizeString(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLen);
}

export function sanitizeHexColor(value: unknown, fallback: string): string {
  if (typeof value === 'string' && HEX_COLOR_RE.test(value.trim())) {
    return value.trim();
  }
  return fallback;
}

export function validateProviderId(value: unknown): ProviderId | null {
  if (typeof value === 'string' && VALID_PROVIDERS.has(value as ProviderId)) {
    return value as ProviderId;
  }
  return null;
}

export function sanitizeAppearance(
  raw: unknown,
  fallback?: AgentAppearance
): AgentAppearance {
  const base: AgentAppearance = fallback || {
    hairColor: '#1f2937',
    skinColor: '#f1c27d',
    shirtColor: '#3b82f6',
    pantsColor: '#1e293b',
    accessory: 'none',
  };
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;
  const acc =
    typeof obj.accessory === 'string' &&
    VALID_ACCESSORIES.has(obj.accessory as NonNullable<AgentAppearance['accessory']>)
      ? (obj.accessory as AgentAppearance['accessory'])
      : base.accessory;

  return {
    hairColor: sanitizeHexColor(obj.hairColor, base.hairColor),
    skinColor: sanitizeHexColor(obj.skinColor, base.skinColor),
    shirtColor: sanitizeHexColor(obj.shirtColor, base.shirtColor),
    pantsColor: sanitizeHexColor(obj.pantsColor, base.pantsColor),
    accessory: acc,
  };
}

function getAllowedRoots(): string[] {
  const raw = process.env.ALLOWED_WORKSPACES;
  const candidates = raw
    ? raw.split(',').map((s) => s.trim()).filter(Boolean)
    : [os.homedir()];

  const roots: string[] = [];
  for (const c of candidates) {
    try {
      roots.push(fs.realpathSync(c));
    } catch {
      // ignore non-existent roots
    }
  }
  return roots.length > 0 ? roots : [os.homedir()];
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function validateWorkspacePath(inputPath: unknown, fallback: string): string | null {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return fallback;
  }
  const trimmed = inputPath.trim();
  if (trimmed.length > 512 || trimmed.includes('\0')) return null;

  try {
    const resolved = fs.realpathSync(trimmed);
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return null;

    const roots = getAllowedRoots();
    if (!roots.some((root) => isPathInsideRoot(resolved, root))) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

export interface ValidatedCreateAgent {
  name: string;
  roleTitle: string;
  provider: ProviderId;
  customCommand?: string;
  cwd: string;
  deskIndex?: number;
  appearance: AgentAppearance;
}

export function parseCreateAgentPayload(
  raw: unknown,
  defaultCwd: string
): ValidatedCreateAgent | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const name = sanitizeString(obj.name, 40);
  if (!name) return null;

  const provider = validateProviderId(obj.provider);
  if (!provider) return null;

  const cwd = validateWorkspacePath(obj.cwd, defaultCwd);
  if (!cwd) return null;

  const roleTitle = sanitizeString(obj.roleTitle, 60, 'Agente IA') || 'Agente IA';
  const customCommand =
    provider === 'custom' ? sanitizeString(obj.customCommand, 300) : undefined;

  let deskIndex: number | undefined;
  if (typeof obj.deskIndex === 'number' && Number.isInteger(obj.deskIndex)) {
    if (obj.deskIndex >= 0 && obj.deskIndex < 6) {
      deskIndex = obj.deskIndex;
    }
  }

  return {
    name,
    roleTitle,
    provider,
    customCommand,
    cwd,
    deskIndex,
    appearance: sanitizeAppearance(obj.appearance),
  };
}

export function parseUpdateAgentPatch(
  raw: unknown,
  existing: AgentRecord,
  defaultCwd: string
): Partial<
  Pick<
    AgentRecord,
    'name' | 'roleTitle' | 'provider' | 'customCommand' | 'cwd' | 'appearance'
  >
> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const patch: Partial<
    Pick<
      AgentRecord,
      'name' | 'roleTitle' | 'provider' | 'customCommand' | 'cwd' | 'appearance'
    >
  > = {};

  if ('name' in obj) {
    const name = sanitizeString(obj.name, 40);
    if (!name) return null;
    patch.name = name;
  }
  if ('roleTitle' in obj) {
    patch.roleTitle = sanitizeString(obj.roleTitle, 60, existing.roleTitle) || existing.roleTitle;
  }
  if ('provider' in obj) {
    const prov = validateProviderId(obj.provider);
    if (!prov) return null;
    patch.provider = prov;
  }
  if ('customCommand' in obj) {
    const targetProv = patch.provider ?? existing.provider;
    patch.customCommand =
      targetProv === 'custom' ? sanitizeString(obj.customCommand, 300) : undefined;
  }
  if ('cwd' in obj) {
    const validCwd = validateWorkspacePath(obj.cwd, defaultCwd);
    if (!validCwd) return null;
    patch.cwd = validCwd;
  }
  if ('appearance' in obj) {
    patch.appearance = sanitizeAppearance(obj.appearance, existing.appearance);
  }

  return patch;
}

export function parseHookPayload(raw: unknown): {
  provider: ProviderId;
  pid?: number;
  event: string;
  tool?: string;
  detail?: string;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const provider =
    obj.provider === undefined ? 'claude' : validateProviderId(obj.provider);
  if (!provider) return null;

  let pid: number | undefined;
  if (obj.pid !== undefined) {
    if (
      typeof obj.pid !== 'number' ||
      !Number.isInteger(obj.pid) ||
      obj.pid <= 0 ||
      obj.pid > 4194304
    ) {
      return null;
    }
    pid = obj.pid;
  }

  const event = sanitizeString(obj.event, 40).toLowerCase();
  const tool = sanitizeString(obj.tool, 40) || undefined;
  const detail = sanitizeString(obj.detail, 80) || undefined;

  return { provider, pid, event, tool, detail };
}

export const MAX_MEETING_PARTICIPANTS = 12;
export const MAX_MEETING_TOPIC_LENGTH = 140;
export const MAX_MEETING_MESSAGE_LENGTH = 8_000;
export const MAX_MEETING_ROUNDS = 3;

export function parseMeetingParticipantIds(
  raw: unknown,
  validAgentIds: Set<string>
): string[] | null {
  if (!Array.isArray(raw)) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || seen.has(id) || !validAgentIds.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_MEETING_PARTICIPANTS) break;
  }
  return result;
}

export function parseMeetingRounds(raw: unknown, fallback = 1): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  const n = Math.trunc(raw);
  return Math.max(1, Math.min(MAX_MEETING_ROUNDS, n));
}

export function parseMeetingTopic(raw: unknown, fallback = ''): string {
  return sanitizeString(raw, MAX_MEETING_TOPIC_LENGTH, fallback);
}

export function parseMeetingMessageContent(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_MEETING_MESSAGE_LENGTH) return null;
  return trimmed;
}

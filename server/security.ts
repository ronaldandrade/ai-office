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

export const SESSION_BOOTSTRAP_HEADER = 'x-office-bootstrap';
export const SESSION_BOOTSTRAP_VALUE = '1';

function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const origin of ALLOWED_ORIGINS) {
    try {
      hosts.add(new URL(origin).host.toLowerCase());
    } catch {
      // ignore malformed origin entries
    }
  }

  const port = Number(process.env.PORT || 3001);
  if (Number.isInteger(port) && port > 0 && port <= 65535) {
    hosts.add(`localhost:${port}`);
    hosts.add(`127.0.0.1:${port}`);
    if (port === 80 || port === 443) {
      hosts.add('localhost');
      hosts.add('127.0.0.1');
    }
    const configuredHost = process.env.HOST?.trim().toLowerCase();
    if (configuredHost && !/[\s/@,]/.test(configuredHost)) {
      hosts.add(`${configuredHost}:${port}`);
    }
  }

  const extraHosts = process.env.ALLOWED_HOSTS;
  if (extraHosts) {
    for (const h of extraHosts.split(',')) {
      const normalized = h.trim().toLowerCase();
      if (normalized && !/[\s/@,]/.test(normalized)) {
        hosts.add(normalized);
      }
    }
  }

  return hosts;
}

export const ALLOWED_HOSTS = buildAllowedHosts();

const BLOCKED_SENSITIVE_HOME_DIRS = [
  '.ssh',
  '.aws',
  '.gnupg',
  '.gpg',
  '.kube',
  '.docker',
  path.join('.config', 'gcloud'),
  path.join('.config', 'gh'),
  '.azure',
  '.pki',
  '.password-store',
  path.join('.local', 'share', 'keyrings'),
  '.mozilla',
  path.join('.config', 'google-chrome'),
  path.join('.config', 'chromium'),
  '.gemini',
  '.claude',
  '.codex',
];

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
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
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

  return undefined;
}

export function extractWebSocketToken(req: IncomingMessage): string | undefined {
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://127.0.0.1');
      if (parsed.searchParams.has('token')) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  return parseCookie(req.headers.cookie, 'office_token');
}

export function isAllowedHost(
  host: string | undefined,
  allowedHosts: ReadonlySet<string> = ALLOWED_HOSTS
): boolean {
  if (!host || typeof host !== 'string') return false;
  const normalized = host.trim().toLowerCase();
  if (!normalized || /[\s/@,]/.test(normalized)) return false;
  return allowedHosts.has(normalized);
}

export function isAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: ReadonlySet<string> = ALLOWED_ORIGINS
): boolean {
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

export interface BootstrapCheckOptions {
  allowedHosts?: ReadonlySet<string>;
  allowedOrigins?: ReadonlySet<string>;
}

export function isSameSiteBootstrapRequest(
  req: IncomingMessage,
  options?: BootstrapCheckOptions
): boolean {
  const allowedHosts = options?.allowedHosts ?? ALLOWED_HOSTS;
  const allowedOrigins = options?.allowedOrigins ?? ALLOWED_ORIGINS;

  if (!isAllowedHost(req.headers.host, allowedHosts)) {
    return false;
  }

  const bootstrapHeader = req.headers[SESSION_BOOTSTRAP_HEADER];
  if (bootstrapHeader !== SESSION_BOOTSTRAP_VALUE) {
    return false;
  }

  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite !== undefined && secFetchSite !== 'same-origin') {
    return false;
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (typeof origin !== 'string' || !isAllowedOrigin(origin, allowedOrigins)) {
      return false;
    }
  } else if (secFetchSite === 'same-origin') {
    return false;
  }

  const referer = req.headers.referer;
  if (referer !== undefined) {
    if (typeof referer !== 'string') return false;
    try {
      const refOrigin = new URL(referer).origin;
      if (!isAllowedOrigin(refOrigin, allowedOrigins)) return false;
    } catch {
      return false;
    }
  }

  return true;
}

export function verifyWebSocketUpgrade(
  info: { origin?: string; req: IncomingMessage },
  expectedToken: string,
  options?: BootstrapCheckOptions
): { ok: true } | { ok: false; code: number; reason: string } {
  try {
    const allowedHosts = options?.allowedHosts ?? ALLOWED_HOSTS;
    const allowedOrigins = options?.allowedOrigins ?? ALLOWED_ORIGINS;

    if (!isAllowedHost(info.req.headers.host, allowedHosts)) {
      return { ok: false, code: 403, reason: 'Forbidden Host' };
    }
    if (!isAllowedOrigin(info.origin, allowedOrigins)) {
      return { ok: false, code: 403, reason: 'Forbidden Origin' };
    }
    const token = extractWebSocketToken(info.req);
    if (!safeCompareToken(token, expectedToken)) {
      return { ok: false, code: 401, reason: 'Unauthorized' };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 400, reason: 'Bad Request' };
  }
}

export function sanitizeString(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replaceAll('\0', '').trim().slice(0, maxLen);
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

function getRealHomeDir(homeDir = os.homedir()): string {
  try {
    return fs.realpathSync(homeDir);
  } catch {
    return path.resolve(homeDir);
  }
}

export function isSensitiveWorkspacePath(resolvedPath: string, homeDir = os.homedir()): boolean {
  const realHome = getRealHomeDir(homeDir);
  for (const rel of BLOCKED_SENSITIVE_HOME_DIRS) {
    const blockedTarget = path.join(realHome, rel);
    if (isPathInsideRoot(resolvedPath, blockedTarget)) {
      return true;
    }
    try {
      const realBlocked = fs.realpathSync(blockedTarget);
      if (realBlocked !== blockedTarget && isPathInsideRoot(resolvedPath, realBlocked)) {
        return true;
      }
    } catch {
      // blocked directory may not exist yet; logical path check above still applies
    }
  }
  return false;
}

function getAllowedRoots(): string[] {
  const raw = process.env.ALLOWED_WORKSPACES;
  const hasExplicitConfig = typeof raw === 'string' && raw.trim().length > 0;
  const candidates = hasExplicitConfig
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

  // Fail closed when ALLOWED_WORKSPACES is explicitly configured but resolves to no valid directories
  if (hasExplicitConfig) {
    return roots;
  }
  return roots.length > 0 ? roots : [getRealHomeDir()];
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const rel = path.relative(rootPath, targetPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateConcreteWorkspacePath(trimmed: string): string | null {
  if (!trimmed || trimmed.length > 512 || trimmed.includes('\0')) return null;

  try {
    const resolved = fs.realpathSync(trimmed);
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return null;

    if (isSensitiveWorkspacePath(resolved)) {
      return null;
    }

    const roots = getAllowedRoots();
    if (roots.length === 0 || !roots.some((root) => isPathInsideRoot(resolved, root))) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

export function validateWorkspacePath(inputPath: unknown, fallback: string): string | null {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    return validateConcreteWorkspacePath(fallback.trim());
  }
  return validateConcreteWorkspacePath(inputPath.trim());
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

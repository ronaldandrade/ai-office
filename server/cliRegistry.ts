import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliProviderInfo, ProviderId } from './types.ts';

interface ProviderSpec {
  id: ProviderId;
  name: string;
  binary: string;
  description: string;
  defaultArgsTemplate: string;
  accentColor: string;
  alwaysAvailable?: boolean;
}

export const DEFAULT_CUSTOM_ALLOWLIST = new Set([
  'ollama',
  'llm',
  'claude',
  'gemini',
  'codex',
  'agy',
  'aider',
  'echo',
]);

export const BLOCKED_SHELL_BINARIES = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'fish',
  'ksh',
  'csh',
  'tcsh',
  'cmd',
  'cmd.exe',
  'powershell',
  'pwsh',
  'env',
  'sudo',
  'su',
  'doas',
  'xargs',
  'nohup',
  'timeout',
]);

const BARE_EXECUTABLE_RE = /^[a-zA-Z0-9._-]+$/;
const UNTRUSTED_BIN_PREFIXES = ['/tmp', '/var/tmp', '/dev/shm'];

const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    binary: 'claude',
    description: 'Anthropic Claude Code CLI (leitura/edição de arquivos e terminal)',
    defaultArgsTemplate: '-p {prompt}',
    accentColor: '#e07a5f',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    binary: 'gemini',
    description: 'Google Gemini CLI local com ferramentas de código',
    defaultArgsTemplate: '-p {prompt}',
    accentColor: '#60a5fa',
  },
  {
    id: 'codex',
    name: 'OpenAI Codex CLI',
    binary: 'codex',
    description: 'OpenAI Codex CLI para tarefas autônomas de engenharia',
    defaultArgsTemplate: 'exec {prompt}',
    accentColor: '#34d399',
  },
  {
    id: 'agy',
    name: 'Antigravity CLI',
    binary: 'agy',
    description: 'Google Antigravity CLI (agente local)',
    defaultArgsTemplate: '-p {prompt}',
    accentColor: '#a78bfa',
  },
  {
    id: 'aider',
    name: 'Aider',
    binary: 'aider',
    description: 'Aider AI pair programming no terminal',
    defaultArgsTemplate: '--message {prompt} --no-auto-commits',
    accentColor: '#fbbf24',
  },
  {
    id: 'custom',
    name: 'CLI Customizado',
    binary: 'ollama',
    description: 'Executável permitido (sem shell) usando {prompt} como argumento',
    defaultArgsTemplate: 'echo Executando: {prompt}',
    accentColor: '#f472b6',
    alwaysAvailable: true,
  },
  {
    id: 'demo',
    name: 'Modo Simulação (Demo)',
    binary: 'builtin',
    description: 'Agente simulado local para testar o escritório vivo sem precisar de CLI',
    defaultArgsTemplate: '',
    accentColor: '#38bdf8',
    alwaysAvailable: true,
  },
];

function isTrustedBinDir(dir: string): boolean {
  if (!dir || !path.isAbsolute(dir) || dir.includes('..')) return false;
  const normalized = path.resolve(dir);
  for (const untrusted of UNTRUSTED_BIN_PREFIXES) {
    if (normalized === untrusted || normalized.startsWith(`${untrusted}${path.sep}`)) {
      return false;
    }
  }
  return true;
}

function getTrustedBinDirs(): string[] {
  const home = os.homedir();
  return [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
  ];
}

function findBinary(binary: string): string | undefined {
  if (!binary || binary.includes('/') || binary.includes('\\') || !BARE_EXECUTABLE_RE.test(binary)) {
    return undefined;
  }

  for (const dir of getTrustedBinDirs()) {
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const real = fs.realpathSync(candidate);
      if (isTrustedBinDir(path.dirname(real))) {
        return real;
      }
    } catch {
      // keep checking
    }
  }

  try {
    const resolved = execFileSync('which', [binary], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (resolved && isTrustedBinDir(path.dirname(resolved))) {
      const real = fs.realpathSync(resolved);
      if (isTrustedBinDir(path.dirname(real))) {
        return real;
      }
    }
  } catch {
    // not found on PATH
  }

  return undefined;
}

export function detectProviders(): CliProviderInfo[] {
  return PROVIDER_SPECS.map((spec) => {
    if (spec.alwaysAvailable) {
      return {
        id: spec.id,
        name: spec.name,
        binary: spec.binary,
        installed: true,
        resolvedPath: spec.binary,
        description: spec.description,
        defaultArgsTemplate: spec.defaultArgsTemplate,
        accentColor: spec.accentColor,
      };
    }

    const resolvedPath = findBinary(spec.binary);
    return {
      id: spec.id,
      name: spec.name,
      binary: spec.binary,
      installed: Boolean(resolvedPath),
      resolvedPath,
      description: spec.description,
      defaultArgsTemplate: spec.defaultArgsTemplate,
      accentColor: spec.accentColor,
    };
  });
}

/**
 * Splits a command template into argv tokens without invoking a shell.
 * Supports single and double quotes for grouping spaces, without shell expansion.
 */
function tokenizeCommandTemplate(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (quote !== null) {
    throw new Error('Aspas não fechadas no comando customizado.');
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

export function buildCliInvocation(
  provider: CliProviderInfo,
  prompt: string,
  customCommand?: string
): { command: string; args: string[]; shell: false } {
  if (provider.id === 'custom') {
    const template = (customCommand || provider.defaultArgsTemplate).trim();
    const tokens = tokenizeCommandTemplate(template);
    if (tokens.length === 0) {
      throw new Error('Comando customizado vazio.');
    }

    const rawExecutable = tokens[0];
    if (rawExecutable.includes('/') || rawExecutable.includes('\\') || rawExecutable.includes('\0')) {
      throw new Error(
        `Caminho de executável não permitido ("${rawExecutable}"). Informe apenas o nome do binário sem separadores de diretório.`
      );
    }

    if (
      rawExecutable === '.' ||
      rawExecutable === '..' ||
      rawExecutable.startsWith('-') ||
      !BARE_EXECUTABLE_RE.test(rawExecutable)
    ) {
      throw new Error(`Nome de executável inválido: "${rawExecutable}".`);
    }

    const normalizedName = rawExecutable.toLowerCase();

    if (BLOCKED_SHELL_BINARIES.has(normalizedName)) {
      throw new Error(
        `Executável "${normalizedName}" bloqueado por segurança. Informe o binário do CLI diretamente (sem shell).`
      );
    }

    const allowAnyCustom = process.env.ENABLE_CUSTOM_CLI === '1';
    if (!allowAnyCustom && !DEFAULT_CUSTOM_ALLOWLIST.has(normalizedName)) {
      throw new Error(
        `Executável "${normalizedName}" não está na lista permitida padrão (${Array.from(DEFAULT_CUSTOM_ALLOWLIST).join(', ')}). Defina ENABLE_CUSTOM_CLI=1 para liberar outros binários.`
      );
    }

    const rawArgs = tokens.slice(1);
    let replaced = false;
    const args = rawArgs.map((arg) => {
      if (arg.includes('{prompt}')) {
        replaced = true;
        return arg.replaceAll('{prompt}', prompt);
      }
      return arg;
    });
    if (!replaced) {
      args.push(prompt);
    }

    const trustedResolved = findBinary(rawExecutable);
    return { command: trustedResolved || rawExecutable, args, shell: false };
  }

  const bin = provider.resolvedPath || provider.binary;
  switch (provider.id) {
    case 'claude':
      return { command: bin, args: ['-p', prompt], shell: false };
    case 'gemini':
      return { command: bin, args: ['-p', prompt], shell: false };
    case 'codex':
      return { command: bin, args: ['exec', prompt], shell: false };
    case 'agy':
      return { command: bin, args: ['-p', prompt], shell: false };
    case 'aider':
      return {
        command: bin,
        args: ['--message', prompt, '--no-auto-commits'],
        shell: false,
      };
    default:
      return { command: bin, args: [prompt], shell: false };
  }
}

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
    defaultArgsTemplate: '--message {prompt} --yes-always',
    accentColor: '#fbbf24',
  },
  {
    id: 'custom',
    name: 'CLI Customizado',
    binary: 'sh',
    description: 'Qualquer comando local usando {prompt} como placeholder',
    defaultArgsTemplate: 'echo "Executando: {prompt}"',
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

function findBinary(binary: string): string | undefined {
  const home = os.homedir();
  const extraDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
  ];

  for (const dir of extraDirs) {
    const candidate = path.join(dir, binary);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep checking
    }
  }

  try {
    const resolved = execFileSync('which', [binary], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (resolved) return resolved;
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

export function buildCliInvocation(
  provider: CliProviderInfo,
  prompt: string,
  customCommand?: string
): { command: string; args: string[]; shell: boolean } {
  if (provider.id === 'custom') {
    const template = (customCommand || provider.defaultArgsTemplate).trim();
    const safePrompt = prompt.replace(/"/g, '\\"');
    const cmd = template.includes('{prompt}')
      ? template.replaceAll('{prompt}', `"${safePrompt}"`)
      : `${template} "${safePrompt}"`;
    return { command: cmd, args: [], shell: true };
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
        args: ['--message', prompt, '--yes-always'],
        shell: false,
      };
    default:
      return { command: bin, args: [prompt], shell: false };
  }
}

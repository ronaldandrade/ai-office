import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  FileText,
  Folder,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { ensureSession } from '../lib/sessionAuth.ts';
import type {
  AgentRecord,
  AgentSummary,
  CliProviderInfo,
} from '../types/office.ts';
import { AgentAvatar } from './AgentAvatar.tsx';

interface AgentDrawerProps {
  agent: AgentRecord | null;
  provider?: CliProviderInfo;
  liveActivity?: string;
  onClose: () => void;
  onSendTask: (agentId: string, prompt: string, cwd?: string) => void;
  onAbortTask: (agentId: string) => void;
  onClearHistory: (agentId: string) => void;
  onEditAgent: (agent: AgentRecord) => void;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export const AgentDrawer: React.FC<AgentDrawerProps> = ({
  agent,
  provider,
  liveActivity,
  onClose,
  onSendTask,
  onAbortTask,
  onClearHistory,
  onEditAgent,
}) => {
  const [prompt, setPrompt] = useState('');
  const [summary, setSummary] = useState<AgentSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [copied, setCopied] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const fetchSummary = useCallback(async (agentId: string) => {
    setLoadingSummary(true);
    try {
      await ensureSession();
      let res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/summary`, {
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        await ensureSession(true);
        res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/summary`, {
          credentials: 'same-origin',
        });
      }
      if (res.ok) {
        const data = (await res.json()) as { summary: AgentSummary | null };
        setSummary(data.summary);
      }
    } catch {
      // ignore network glitches
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  // Fetch latest summary immediately when clicking an agent or when it finishes a task
  useEffect(() => {
    if (!agent) {
      setSummary(null);
      return;
    }
    fetchSummary(agent.id);
  }, [agent?.id, agent?.status, agent?.messages.length, fetchSummary]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent?.messages.length, agent?.messages[agent.messages.length - 1]?.content]);

  if (!agent) {
    return (
      <aside className="drawer empty">
        <div className="drawer-empty-state">
          <div className="empty-emoji">🪑</div>
          <h3>Selecione um Agente</h3>
          <p>
            Clique em qualquer personagem andando pelo escritório ou na lista à esquerda
            para ver o último resumo entregue e enviar tarefas.
          </p>
        </div>
      </aside>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed) return;
    onSendTask(agent.id, trimmed, agent.cwd);
    setPrompt('');
  };

  const handleCopySummary = () => {
    if (!summary?.summary) return;
    navigator.clipboard?.writeText(summary.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div className="drawer-agent-info">
          <AgentAvatar agent={agent} size="lg" showStatusDot />
          <div>
            <h3>{agent.name}</h3>
            <p className="drawer-role">{agent.roleTitle}</p>
          </div>
        </div>

        <div className="drawer-actions">
          <button
            className="icon-btn"
            title="Configurar CLI e aparência"
            onClick={() => onEditAgent(agent)}
          >
            <Settings2 size={15} />
          </button>
          <button
            className="icon-btn"
            title="Limpar histórico web"
            onClick={() => onClearHistory(agent.id)}
          >
            <Trash2 size={15} />
          </button>
          <button className="icon-btn" title="Fechar painel" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="drawer-subbar">
        <span className="subbar-chip">
          <Terminal size={12} />
          {provider?.name || agent.provider}
          {agent.origin === 'terminal' && agent.terminalPid
            ? ` (Terminal PID ${agent.terminalPid})`
            : ''}
          {provider && !provider.installed && provider.id !== 'demo' && provider.id !== 'custom'
            ? ' (fallback demo)'
            : ''}
        </span>
        <span className="subbar-chip" title={agent.cwd}>
          <Folder size={12} />
          {agent.cwd.split('/').slice(-2).join('/')}
        </span>
      </div>

      <div className="drawer-live-status">
        <span className={`pulse-dot ${agent.status}`} />
        <span>{liveActivity || 'No escritório'}</span>
      </div>

      <section className="summary-card">
        <div className="summary-card-header">
          <div className="summary-title">
            <FileText size={13} />
            <span>Último resumo entregue</span>
          </div>
          <div className="summary-actions">
            {summary && (
              <button
                className="icon-mini-btn"
                title="Copiar resumo"
                onClick={handleCopySummary}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
            <button
              className="icon-mini-btn"
              title="Atualizar resumo"
              onClick={() => fetchSummary(agent.id)}
            >
              <RefreshCw size={12} className={loadingSummary ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {loadingSummary && !summary ? (
          <p className="summary-empty">Buscando última entrega...</p>
        ) : summary ? (
          <>
            <div className="summary-meta">
              <span>{summary.source}</span>
              <span>•</span>
              <span>{formatTime(summary.timestamp)}</span>
            </div>
            {summary.lastPrompt && (
              <div className="summary-prompt" title={summary.lastPrompt}>
                <strong>Pedido:</strong> {summary.lastPrompt}
              </div>
            )}
            <div className="summary-body">{summary.summary}</div>
            {summary.toolsUsed.length > 0 && (
              <div className="summary-tools">
                {summary.toolsUsed.map((t) => (
                  <span key={t} className="tool-chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="summary-empty">
            Nenhum resumo encontrado ainda para este agente. Assim que ele concluir uma
            tarefa no terminal ou por aqui, o resultado aparece aqui.
          </p>
        )}
      </section>

      <div className="chat-messages">
        {agent.messages.length === 0 ? (
          <div className="chat-welcome">
            <p className="muted">
              Quer enviar uma nova tarefa direto daqui? Digite abaixo ou use um atalho:
            </p>
            <div className="quick-prompts">
              <button
                onClick={() =>
                  onSendTask(
                    agent.id,
                    'Liste os arquivos principais deste workspace e resuma o que temos aqui.',
                    agent.cwd
                  )
                }
              >
                📂 Resumir workspace
              </button>
              <button
                onClick={() =>
                  onSendTask(
                    agent.id,
                    'Verifique o git status e sugira as próximas melhorias prioritárias.',
                    agent.cwd
                  )
                }
              >
                🔍 Checar status do projeto
              </button>
            </div>
          </div>
        ) : (
          agent.messages.map((m) => (
            <div key={m.id} className={`chat-bubble ${m.role} ${m.status || ''}`}>
              <div className="bubble-header">
                <span>{m.role === 'user' ? 'Você' : agent.name}</span>
                {m.status === 'streaming' && (
                  <span className="streaming-tag">{m.toolActivity || 'Executando...'}</span>
                )}
              </div>
              <pre className="bubble-content">
                {m.content || (m.status === 'streaming' ? '⏳ Aguardando saída do CLI...' : '')}
              </pre>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <textarea
          rows={2}
          placeholder={`Peça algo para ${agent.name}... (Enter para enviar)`}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <div className="composer-actions">
          {agent.status === 'working' ? (
            <button
              type="button"
              className="danger-btn"
              onClick={() => onAbortTask(agent.id)}
            >
              <Square size={14} />
              <span>Parar</span>
            </button>
          ) : (
            <button type="submit" className="primary-btn" disabled={!prompt.trim()}>
              <Send size={14} />
              <span>Enviar</span>
            </button>
          )}
        </div>
      </form>
    </aside>
  );
};

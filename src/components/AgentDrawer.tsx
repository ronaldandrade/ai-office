import React, { useEffect, useRef, useState } from 'react';
import {
  Folder,
  Send,
  Settings2,
  Square,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import type { AgentRecord, CliProviderInfo } from '../types/office.ts';

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
  const endRef = useRef<HTMLDivElement | null>(null);

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
            para conversar e enviar tarefas reais via CLI.
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

  return (
    <aside className="drawer">
      <div className="drawer-header">
        <div className="drawer-agent-info">
          <div
            className="agent-avatar-swatch large"
            style={{ background: agent.appearance.shirtColor }}
          >
            <span>{agent.name.slice(0, 1).toUpperCase()}</span>
            <span className={`status-dot ${agent.status}`} />
          </div>
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
            title="Limpar histórico"
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

      <div className="chat-messages">
        {agent.messages.length === 0 ? (
          <div className="chat-welcome">
            <p>
              <strong>{agent.name}</strong> está no escritório agora ({liveActivity || 'disponível'}).
            </p>
            <p className="muted">
              Envie uma tarefa abaixo — ele vai interromper o café/bate-papo, caminhar até
              a mesa e executar o comando no workspace configurado.
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

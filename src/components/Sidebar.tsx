import React from 'react';
import { Plus, Settings2, Terminal } from 'lucide-react';
import { safeHexColor } from '../lib/sessionAuth.ts';
import type { AgentRecord, CliProviderInfo, MeetingState } from '../types/office.ts';

interface SidebarProps {
  agents: AgentRecord[];
  providers: CliProviderInfo[];
  activities: Record<string, string>;
  meeting: MeetingState;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onOpenAddModal: () => void;
  onEditAgent: (agent: AgentRecord) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  agents,
  providers,
  activities,
  meeting,
  selectedAgentId,
  onSelectAgent,
  onOpenAddModal,
  onEditAgent,
}) => {
  const providerMap = new Map(providers.map((p) => [p.id, p]));
  const meetingParticipantSet = new Set(
    meeting.active ? meeting.participantIds : []
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div>
          <h2>Equipe ({agents.length})</h2>
          <p>Clique em um agente para delegar tarefas</p>
        </div>
        <button className="primary-btn small" onClick={onOpenAddModal}>
          <Plus size={14} />
          <span>Novo</span>
        </button>
      </div>

      <div className="agent-list">
        {agents.length === 0 && (
          <div className="empty-sidebar-hint">
            <p>
              <strong>Escritório aguardando equipe...</strong>
            </p>
            <p>
              Inicie <code>claude</code>, <code>agy</code>, <code>gemini</code> ou{' '}
              <code>codex</code> em qualquer terminal — eles entram automaticamente aqui!
            </p>
            <p>Ou clique em <strong>+ Novo</strong> para chamar outro agente pela interface.</p>
          </div>
        )}
        {agents.map((agent) => {
          const prov = providerMap.get(agent.provider);
          const isSelected = agent.id === selectedAgentId;
          const liveActivity =
            activities[agent.id] ||
            (agent.status === 'working'
              ? agent.currentActivity || 'Trabalhando...'
              : 'No escritório');

          return (
            <div
              key={agent.id}
              className={`agent-card ${isSelected ? 'selected' : ''} ${agent.status}`}
              onClick={() => onSelectAgent(agent.id)}
            >
              <div className="agent-card-top">
                <div
                  className="agent-avatar-swatch"
                  style={{ background: safeHexColor(agent.appearance.shirtColor) }}
                >
                  <span>{agent.name.slice(0, 1).toUpperCase()}</span>
                  <span className={`status-dot ${agent.status}`} />
                </div>

                <div className="agent-card-meta">
                  <div className="agent-name-row">
                    <strong>{agent.name}</strong>
                    <div className="agent-name-badges">
                      {meetingParticipantSet.has(agent.id) && (
                        <span
                          className="origin-badge meeting"
                          title="Participando da reunião em grupo"
                        >
                          REUNIÃO
                        </span>
                      )}
                      {agent.origin === 'terminal' && (
                        <span
                          className="origin-badge terminal"
                          title={`Detectado no terminal (PID ${agent.terminalPid})`}
                        >
                          TTY
                        </span>
                      )}
                      <button
                        className="icon-mini-btn"
                        title="Configurar agente / CLI"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditAgent(agent);
                        }}
                      >
                        <Settings2 size={13} />
                      </button>
                    </div>
                  </div>
                  <span className="agent-role">{agent.roleTitle}</span>
                </div>
              </div>

              <div className="agent-card-footer">
                <span className="provider-tag">
                  <Terminal size={11} />
                  {prov?.name || agent.provider}
                  {agent.origin === 'terminal' && agent.terminalPid
                    ? ` • PID ${agent.terminalPid}`
                    : ''}
                </span>
                <span className="activity-pill">{liveActivity}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebar-providers">
        <h3>Provedores CLI Locais</h3>
        <div className="provider-pills">
          {providers
            .filter((p) => p.id !== 'custom' && p.id !== 'demo')
            .map((p) => (
              <div
                key={p.id}
                className={`provider-status-row ${p.installed ? 'ok' : 'missing'}`}
                title={p.resolvedPath || `${p.binary} não encontrado no PATH`}
              >
                <span className="dot" />
                <span className="name">{p.name}</span>
                <span className="badge">{p.installed ? 'Pronto' : 'Não instalado'}</span>
              </div>
            ))}
        </div>
      </div>
    </aside>
  );
};

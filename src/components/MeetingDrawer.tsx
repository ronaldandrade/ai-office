import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Folder,
  Mic,
  PhoneOff,
  Play,
  Send,
  Square,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { safeHexColor } from '../lib/sessionAuth.ts';
import type {
  AgentRecord,
  CliProviderInfo,
  MeetingState,
} from '../types/office.ts';
import { AgentAvatar } from './AgentAvatar.tsx';

interface MeetingDrawerProps {
  meeting: MeetingState;
  agents: AgentRecord[];
  providers: CliProviderInfo[];
  defaultCwd: string;
  onClose: () => void;
  onStartMeeting: (payload: {
    participantIds: string[];
    topic?: string;
    cwd?: string;
    maxRounds?: number;
  }) => void;
  onUpdateMeeting: (patch: {
    participantIds?: string[];
    topic?: string;
    cwd?: string;
    maxRounds?: number;
  }) => void;
  onSendMessage: (content: string, rounds?: number) => void;
  onAbortMeeting: () => void;
  onClearHistory: () => void;
  onEndMeeting: () => void;
  onOpenAddAgent: () => void;
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

export const MeetingDrawer: React.FC<MeetingDrawerProps> = ({
  meeting,
  agents,
  providers,
  defaultCwd,
  onClose,
  onStartMeeting,
  onUpdateMeeting,
  onSendMessage,
  onAbortMeeting,
  onClearHistory,
  onEndMeeting,
  onOpenAddAgent,
}) => {
  const [draftParticipantIds, setDraftParticipantIds] = useState<string[]>(() =>
    meeting.participantIds.length > 0
      ? meeting.participantIds
      : agents.map((a) => a.id)
  );
  const [topicDraft, setTopicDraft] = useState(meeting.topic);
  const [rounds, setRounds] = useState(meeting.maxRounds || 1);
  const [messageInput, setMessageInput] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const providerMap = useMemo(
    () => new Map(providers.map((p) => [p.id, p])),
    [providers]
  );

  const agentsById = useMemo(
    () => new Map(agents.map((a) => [a.id, a])),
    [agents]
  );

  const agentIdsKey = useMemo(() => agents.map((a) => a.id).join(','), [agents]);
  const prevAgentCountRef = useRef(agents.length);

  // Sync topic and rounds only when server meeting config changes (not on agent status ticks)
  useEffect(() => {
    if (meeting.active) {
      setTopicDraft(meeting.topic);
    }
  }, [meeting.active, meeting.topic]);

  useEffect(() => {
    if (meeting.active) {
      setRounds(meeting.maxRounds || 1);
    }
  }, [meeting.active, meeting.maxRounds]);

  // Sync draft selection only when meeting participants or the set of live agent IDs changes
  useEffect(() => {
    const liveIds = agentIdsKey ? agentIdsKey.split(',') : [];
    if (meeting.active) {
      setDraftParticipantIds(meeting.participantIds);
    } else {
      const liveSet = new Set(liveIds);
      const loadedFirstAgents = prevAgentCountRef.current === 0 && liveIds.length > 0;
      setDraftParticipantIds((prev) => {
        if (loadedFirstAgents && prev.length === 0) {
          return liveIds;
        }
        return prev.filter((id) => liveSet.has(id));
      });
    }
    prevAgentCountRef.current = liveIds.length;
  }, [meeting.active, meeting.participantIds, agentIdsKey]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [
    meeting.messages.length,
    meeting.messages[meeting.messages.length - 1]?.content,
  ]);

  const activeParticipantIds = meeting.active
    ? meeting.participantIds
    : draftParticipantIds;

  const activeParticipants = useMemo(
    () =>
      activeParticipantIds
        .map((id) => agentsById.get(id))
        .filter((a): a is AgentRecord => Boolean(a)),
    [activeParticipantIds, agentsById]
  );

  const currentSpeaker = meeting.currentSpeakerId
    ? agentsById.get(meeting.currentSpeakerId)
    : undefined;

  const toggleParticipant = (agentId: string) => {
    if (meeting.active) {
      const exists = meeting.participantIds.includes(agentId);
      if (exists && meeting.participantIds.length <= 1) {
        return; // Keep at least 1 participant while meeting is active
      }
      const next = exists
        ? meeting.participantIds.filter((id) => id !== agentId)
        : [...meeting.participantIds, agentId];
      onUpdateMeeting({ participantIds: next });
    } else {
      setDraftParticipantIds((prev) =>
        prev.includes(agentId)
          ? prev.filter((id) => id !== agentId)
          : [...prev, agentId]
      );
    }
  };

  const selectAllParticipants = () => {
    const allIds = agents.map((a) => a.id);
    if (allIds.length === 0) return;
    if (meeting.active) {
      onUpdateMeeting({ participantIds: allIds });
    } else {
      setDraftParticipantIds(allIds);
    }
  };

  const handleStart = () => {
    if (draftParticipantIds.length === 0) return;
    onStartMeeting({
      participantIds: draftParticipantIds,
      topic: topicDraft.trim(),
      cwd: defaultCwd,
      maxRounds: rounds,
    });
  };

  const handleRoundsChange = (nextRounds: number) => {
    setRounds(nextRounds);
    if (meeting.active) {
      onUpdateMeeting({ maxRounds: nextRounds });
    }
  };

  const handleTopicBlur = () => {
    if (meeting.active && topicDraft.trim() !== meeting.topic) {
      onUpdateMeeting({ topic: topicDraft.trim() });
    }
  };

  const handleInsertMention = (name: string) => {
    const token = `@${name.split(/\s+/)[0]} `;
    setMessageInput((prev) => (prev ? `${prev.trimEnd()} ${token}` : token));
    textareaRef.current?.focus();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed || !meeting.active || meeting.status === 'running') return;
    onSendMessage(trimmed, rounds);
    setMessageInput('');
  };

  const hasConversationMessages = meeting.messages.some(
    (m) => m.senderType !== 'system'
  );

  return (
    <aside className="drawer meeting-drawer">
      <div className="drawer-header">
        <div className="drawer-agent-info">
          <div className="meeting-header-badge">
            <Users size={18} />
          </div>
          <div>
            <h3>Sala de Reunião</h3>
            <p className="drawer-role">
              {meeting.active
                ? `${activeParticipants.length} ${
                    activeParticipants.length === 1 ? 'agente' : 'agentes'
                  } na mesa`
                : 'Chat colaborativo em grupo'}
            </p>
          </div>
        </div>

        <div className="drawer-actions">
          {meeting.messages.length > 0 && (
            <button
              className="icon-btn"
              title="Limpar histórico da reunião"
              onClick={onClearHistory}
            >
              <Trash2 size={15} />
            </button>
          )}
          {meeting.active && (
            <button
              className="icon-btn danger-icon-btn"
              title="Encerrar reunião"
              onClick={onEndMeeting}
            >
              <PhoneOff size={15} />
            </button>
          )}
          <button className="icon-btn" title="Fechar painel" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="drawer-subbar">
        <span className={`subbar-chip meeting-state-chip ${meeting.active ? 'active' : ''}`}>
          <span
            className={`pulse-dot ${
              meeting.status === 'running'
                ? 'working'
                : meeting.active
                  ? 'meeting'
                  : 'idle'
            }`}
          />
          {meeting.status === 'running'
            ? `Em debate (Rodada ${meeting.currentRound}/${meeting.maxRounds})`
            : meeting.active
              ? 'Reunião ativa'
              : 'Pronta para iniciar'}
        </span>
        <span className="subbar-chip" title={meeting.cwd || defaultCwd}>
          <Folder size={12} />
          {(meeting.cwd || defaultCwd).split('/').slice(-2).join('/') || 'workspace'}
        </span>
      </div>

      {/* Participant selector & meeting controls */}
      <section className="meeting-config-panel">
        <div className="meeting-config-row">
          <span className="meeting-section-label">Participantes</span>
          {agents.length > 1 && (
            <button
              type="button"
              className="link-mini-btn"
              onClick={selectAllParticipants}
            >
              Selecionar todos
            </button>
          )}
        </div>

        {agents.length === 0 ? (
          <div className="meeting-empty-agents">
            <p>Nenhum agente no escritório ainda.</p>
            <button
              type="button"
              className="primary-btn small"
              onClick={onOpenAddAgent}
            >
              + Adicionar Agente
            </button>
          </div>
        ) : (
          <>
            <div className="participant-chips">
              {agents.map((agent) => {
                const selected = activeParticipantIds.includes(agent.id);
                const isSpeaking =
                  meeting.status === 'running' &&
                  meeting.currentSpeakerId === agent.id;
                const prov = providerMap.get(agent.provider);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    className={`participant-chip ${selected ? 'selected' : ''} ${
                      isSpeaking ? 'speaking' : ''
                    }`}
                    onClick={() => toggleParticipant(agent.id)}
                    title={`${agent.name} — ${prov?.name || agent.provider}`}
                  >
                    <span
                      className="participant-dot"
                      style={{ background: safeHexColor(agent.appearance.shirtColor) }}
                    />
                    <span className="participant-name">{agent.name}</span>
                    {selected && <Check size={11} />}
                  </button>
                );
              })}
            </div>

            <div className="meeting-meta-inputs">
              <input
                type="text"
                className="meeting-topic-input"
                placeholder="Pauta / tema da reunião (opcional)..."
                value={topicDraft}
                maxLength={140}
                onChange={(e) => setTopicDraft(e.target.value)}
                onBlur={handleTopicBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
              <div className="rounds-selector" title="Quantas rodadas de debate por mensagem">
                {[1, 2, 3].map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`round-pill ${rounds === r ? 'active' : ''}`}
                    onClick={() => handleRoundsChange(r)}
                  >
                    {r}x
                  </button>
                ))}
              </div>
            </div>

            {!meeting.active && (
              <button
                type="button"
                className="primary-btn meeting-start-btn"
                disabled={draftParticipantIds.length === 0}
                onClick={handleStart}
              >
                <Play size={14} />
                <span>
                  Reunir {draftParticipantIds.length}{' '}
                  {draftParticipantIds.length === 1 ? 'Agente' : 'Agentes'}
                </span>
              </button>
            )}
          </>
        )}
      </section>

      {/* Live speaking indicator */}
      {meeting.status === 'running' && currentSpeaker && (
        <div className="meeting-speaking-bar">
          <div className="meeting-speaking-info">
            <Mic size={13} />
            <span>
              <strong>{currentSpeaker.name}</strong> está respondendo
              {meeting.maxRounds > 1
                ? ` • Rodada ${meeting.currentRound}/${meeting.maxRounds}`
                : '...'}
            </span>
          </div>
          <button
            type="button"
            className="danger-btn compact"
            onClick={onAbortMeeting}
          >
            <Square size={11} />
            <span>Parar</span>
          </button>
        </div>
      )}

      {/* Group conversation thread */}
      <div className="chat-messages meeting-messages">
        {!hasConversationMessages && meeting.messages.length === 0 ? (
          <div className="chat-welcome">
            <p className="muted">
              {meeting.active
                ? 'Todos os participantes já estão na sala! Envie um tema abaixo — cada agente lerá as respostas dos colegas antes de falar.'
                : 'Escolha os agentes acima e clique em Reunir para iniciar uma conversa colaborativa em grupo.'}
            </p>
            {meeting.active && (
              <div className="quick-prompts">
                <button
                  type="button"
                  disabled={meeting.status === 'running'}
                  onClick={() =>
                    onSendMessage(
                      'Analisem juntos a arquitetura atual deste workspace e sugiram as 3 melhorias de maior impacto.',
                      rounds
                    )
                  }
                >
                  🏗️ Debater arquitetura do projeto
                </button>
                <button
                  type="button"
                  disabled={meeting.status === 'running'}
                  onClick={() =>
                    onSendMessage(
                      'Cada um aponte um possível risco, bug ou ponto fraco no código atual e proponha como resolver.',
                      rounds
                    )
                  }
                >
                  🐛 Revisar riscos e bugs juntos
                </button>
                <button
                  type="button"
                  disabled={meeting.status === 'running'}
                  onClick={() =>
                    onSendMessage(
                      'Vamos planejar os próximos passos: dividam responsabilidades entre vocês e proponham um plano curto.',
                      rounds
                    )
                  }
                >
                  🚀 Planejar próximos passos
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            {meeting.messages.map((m) => {
              if (m.senderType === 'system') {
                return (
                  <div key={m.id} className="meeting-system-notice">
                    <span>{m.content}</span>
                  </div>
                );
              }

              if (m.senderType === 'user') {
                return (
                  <div key={m.id} className="chat-bubble user">
                    <div className="bubble-header">
                      <span>Você</span>
                      <span className="bubble-time">{formatTime(m.timestamp)}</span>
                    </div>
                    <pre className="bubble-content">{m.content}</pre>
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={`chat-bubble assistant meeting-agent-bubble ${m.status || ''}`}
                >
                  <div className="bubble-header">
                    <div className="meeting-sender-meta">
                      {m.senderId && agentsById.has(m.senderId) ? (
                        <AgentAvatar agent={agentsById.get(m.senderId)!} size="sm" />
                      ) : (
                        <span
                          className="meeting-sender-avatar"
                          style={{
                            background: safeHexColor(m.senderColor || '#38bdf8'),
                          }}
                        >
                          {m.senderName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <button
                        type="button"
                        className="meeting-sender-name-btn"
                        title={`Mencionar @${m.senderName}`}
                        onClick={() => handleInsertMention(m.senderName)}
                      >
                        {m.senderName}
                      </button>
                      {m.round && meeting.maxRounds > 1 && (
                        <span className="meeting-round-tag">R{m.round}</span>
                      )}
                    </div>
                    {m.status === 'streaming' ? (
                      <span className="streaming-tag">
                        {m.toolActivity || 'Respondendo...'}
                      </span>
                    ) : (
                      <span className="bubble-time">{formatTime(m.timestamp)}</span>
                    )}
                  </div>
                  <pre className="bubble-content">
                    {m.content ||
                      (m.status === 'streaming'
                        ? '⏳ Lendo histórico e formulando resposta...'
                        : '')}
                  </pre>
                </div>
              );
            })}

            {!hasConversationMessages && meeting.active && (
              <div className="chat-welcome compact-welcome">
                <div className="quick-prompts">
                  <button
                    type="button"
                    disabled={meeting.status === 'running'}
                    onClick={() =>
                      onSendMessage(
                        'Analisem juntos a arquitetura atual deste workspace e sugiram as 3 melhorias de maior impacto.',
                        rounds
                      )
                    }
                  >
                    🏗️ Debater arquitetura do projeto
                  </button>
                  <button
                    type="button"
                    disabled={meeting.status === 'running'}
                    onClick={() =>
                      onSendMessage(
                        'Vamos planejar os próximos passos: dividam responsabilidades entre vocês e proponham um plano curto.',
                        rounds
                      )
                    }
                  >
                    🚀 Planejar próximos passos
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form className="chat-composer" onSubmit={handleSubmit}>
        {meeting.active && activeParticipants.length > 0 && (
          <div className="mention-bar">
            <span className="mention-hint">Mencionar:</span>
            {activeParticipants.map((p) => (
              <button
                key={p.id}
                type="button"
                className="mention-chip"
                onClick={() => handleInsertMention(p.name)}
              >
                @{p.name.split(/\s+/)[0]}
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={2}
          disabled={!meeting.active}
          placeholder={
            meeting.active
              ? 'Envie uma pauta ou pergunta para o grupo... (use @Nome para direcionar)'
              : 'Inicie a reunião acima para enviar mensagens ao grupo...'
          }
          value={messageInput}
          onChange={(e) => setMessageInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <div className="composer-actions">
          {meeting.status === 'running' ? (
            <button
              type="button"
              className="danger-btn"
              onClick={onAbortMeeting}
            >
              <Square size={14} />
              <span>Parar rodada</span>
            </button>
          ) : (
            <button
              type="submit"
              className="primary-btn"
              disabled={!meeting.active || !messageInput.trim()}
            >
              <Send size={14} />
              <span>Enviar ao grupo</span>
            </button>
          )}
        </div>
      </form>
    </aside>
  );
};

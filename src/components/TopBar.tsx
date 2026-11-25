import React, { useState } from 'react';
import {
  FolderOpen,
  Pause,
  Play,
  RefreshCw,
  Terminal,
  Users,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import type { CliProviderInfo, MeetingState } from '../types/office.ts';

interface TopBarProps {
  connected: boolean;
  providers: CliProviderInfo[];
  defaultCwd: string;
  paused: boolean;
  simSpeed: number;
  meeting: MeetingState;
  meetingOpen: boolean;
  onToggleMeeting: () => void;
  onTogglePause: () => void;
  onChangeSpeed: (speed: number) => void;
  onRefreshProviders: () => void;
  onChangeDefaultCwd: (cwd: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  connected,
  providers,
  defaultCwd,
  paused,
  simSpeed,
  meeting,
  meetingOpen,
  onToggleMeeting,
  onTogglePause,
  onChangeSpeed,
  onRefreshProviders,
  onChangeDefaultCwd,
}) => {
  const [editingCwd, setEditingCwd] = useState(false);
  const [cwdDraft, setCwdDraft] = useState(defaultCwd);

  const detectedRealClis = providers.filter(
    (p) => p.installed && p.id !== 'demo' && p.id !== 'custom'
  );

  const commitCwd = () => {
    setEditingCwd(false);
    if (cwdDraft.trim() && cwdDraft.trim() !== defaultCwd) {
      onChangeDefaultCwd(cwdDraft.trim());
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <div className="brand-badge">🏢</div>
        <div>
          <h1 className="brand-title">AI Office</h1>
          <span className="brand-subtitle">Escritório Vivo de Agentes Locais</span>
        </div>
      </div>

      <div className="topbar-center">
        <div className="cwd-chip" title="Diretório de trabalho padrão para os agentes">
          <FolderOpen size={14} />
          {editingCwd ? (
            <input
              className="cwd-input"
              value={cwdDraft}
              onChange={(e) => setCwdDraft(e.target.value)}
              onBlur={commitCwd}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCwd();
                if (e.key === 'Escape') setEditingCwd(false);
              }}
              autoFocus
            />
          ) : (
            <button
              className="cwd-button"
              onClick={() => {
                setCwdDraft(defaultCwd);
                setEditingCwd(true);
              }}
            >
              {defaultCwd || 'Definir workspace...'}
            </button>
          )}
        </div>

        <div className="cli-status-chip" title="CLIs locais detectados no sistema">
          <Terminal size={14} />
          <span>
            CLIs:{' '}
            {detectedRealClis.length > 0
              ? detectedRealClis.map((c) => c.binary).join(', ')
              : 'modo demo'}
          </span>
          <button
            className="icon-mini-btn"
            onClick={onRefreshProviders}
            title="Re-escanear CLIs instalados"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="topbar-controls">
        <button
          className={`meeting-top-btn ${meetingOpen ? 'open' : ''} ${
            meeting.active ? 'active' : ''
          }`}
          onClick={onToggleMeeting}
          title="Abrir Modo Reunião / Chat em Grupo"
        >
          <Users size={14} />
          <span>
            {meeting.status === 'running'
              ? `Reunião (${meeting.participantIds.length})`
              : meeting.active
                ? `Reunião (${meeting.participantIds.length})`
                : 'Reunião'}
          </span>
          {meeting.active && (
            <span
              className={`meeting-top-dot ${
                meeting.status === 'running' ? 'running' : ''
              }`}
            />
          )}
        </button>

        <div className="sim-controls">
          <button
            className="control-btn"
            onClick={onTogglePause}
            title={paused ? 'Retomar vida do escritório' : 'Pausar simulação'}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            className={`control-btn ${simSpeed > 1 ? 'active' : ''}`}
            onClick={() => onChangeSpeed(simSpeed === 1 ? 2 : 1)}
            title="Alternar velocidade 1x / 2x"
          >
            <Zap size={14} />
            <span>{simSpeed}x</span>
          </button>
        </div>

        <div className={`conn-pill ${connected ? 'online' : 'offline'}`}>
          {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          <span>{connected ? 'Online' : 'Reconectando'}</span>
        </div>
      </div>
    </header>
  );
};

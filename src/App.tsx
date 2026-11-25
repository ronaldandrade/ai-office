import React, { useCallback, useMemo, useState } from 'react';
import { AddAgentModal } from './components/AddAgentModal.tsx';
import { AgentDrawer } from './components/AgentDrawer.tsx';
import { MeetingDrawer } from './components/MeetingDrawer.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { TopBar } from './components/TopBar.tsx';
import { OfficeCanvas } from './engine/OfficeCanvas.tsx';
import { useOfficeSocket } from './hooks/useOfficeSocket.ts';
import type { AgentRecord } from './types/office.ts';

export const App: React.FC = () => {
  const { connected, defaultCwd, providers, agents, meeting, lastError, send } =
    useOfficeSocket();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [activities, setActivities] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedAgent?.provider),
    [providers, selectedAgent]
  );

  const handleActivitiesUpdate = useCallback((next: Record<string, string>) => {
    setActivities(next);
  }, []);

  const handleSelectAgent = useCallback((agentId: string) => {
    setMeetingOpen(false);
    setSelectedAgentId(agentId);
  }, []);

  const handleToggleMeeting = useCallback(() => {
    setMeetingOpen((prev) => !prev);
  }, []);

  const handleOpenAdd = () => {
    setEditingAgent(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (agent: AgentRecord) => {
    setEditingAgent(agent);
    setModalOpen(true);
  };

  return (
    <div className="app-shell">
      <TopBar
        connected={connected}
        providers={providers}
        defaultCwd={defaultCwd}
        paused={paused}
        simSpeed={simSpeed}
        meeting={meeting}
        meetingOpen={meetingOpen}
        onToggleMeeting={handleToggleMeeting}
        onTogglePause={() => setPaused((p) => !p)}
        onChangeSpeed={setSimSpeed}
        onRefreshProviders={() => send({ type: 'refresh_providers' })}
        onChangeDefaultCwd={(cwd) => send({ type: 'set_default_cwd', cwd })}
      />

      {lastError && <div className="error-banner">⚠️ {lastError}</div>}

      <main className="app-main">
        <Sidebar
          agents={agents}
          providers={providers}
          activities={activities}
          meeting={meeting}
          selectedAgentId={meetingOpen ? null : selectedAgentId}
          onSelectAgent={handleSelectAgent}
          onOpenAddModal={handleOpenAdd}
          onEditAgent={handleOpenEdit}
        />

        <section className="stage-container">
          <OfficeCanvas
            agents={agents}
            meeting={meeting}
            selectedAgentId={meetingOpen ? null : selectedAgentId}
            onSelectAgent={handleSelectAgent}
            paused={paused}
            simSpeed={simSpeed}
            onActivitiesUpdate={handleActivitiesUpdate}
          />
        </section>

        {meetingOpen ? (
          <MeetingDrawer
            meeting={meeting}
            agents={agents}
            providers={providers}
            defaultCwd={defaultCwd}
            onClose={() => setMeetingOpen(false)}
            onStartMeeting={(payload) =>
              send({ type: 'start_meeting', ...payload })
            }
            onUpdateMeeting={(patch) =>
              send({ type: 'update_meeting', ...patch })
            }
            onSendMessage={(content, rounds) =>
              send({ type: 'send_meeting_message', content, rounds })
            }
            onAbortMeeting={() => send({ type: 'abort_meeting' })}
            onClearHistory={() => send({ type: 'clear_meeting_history' })}
            onEndMeeting={() => send({ type: 'end_meeting' })}
            onOpenAddAgent={handleOpenAdd}
          />
        ) : (
          <AgentDrawer
            agent={selectedAgent}
            provider={selectedProvider}
            liveActivity={selectedAgent ? activities[selectedAgent.id] : undefined}
            onClose={() => setSelectedAgentId(null)}
            onSendTask={(agentId, prompt, cwd) =>
              send({ type: 'run_task', agentId, prompt, cwd })
            }
            onAbortTask={(agentId) => send({ type: 'abort_task', agentId })}
            onClearHistory={(agentId) => send({ type: 'clear_history', agentId })}
            onEditAgent={handleOpenEdit}
          />
        )}
      </main>

      {modalOpen && (
        <AddAgentModal
          providers={providers}
          defaultCwd={defaultCwd}
          editingAgent={editingAgent}
          onClose={() => setModalOpen(false)}
          onSave={(payload) => {
            if (payload.id) {
              const { id, ...patch } = payload;
              send({ type: 'update_agent', agentId: id, patch });
            } else {
              const { id: _ignore, ...agent } = payload;
              send({ type: 'create_agent', agent });
            }
          }}
          onDelete={(agentId) => {
            send({ type: 'delete_agent', agentId });
            if (selectedAgentId === agentId) setSelectedAgentId(null);
          }}
        />
      )}
    </div>
  );
};

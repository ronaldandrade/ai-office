import { useCallback, useEffect, useRef, useState } from 'react';
import { clearCachedSession, ensureSession } from '../lib/sessionAuth.ts';
import type {
  AgentRecord,
  CliProviderInfo,
  MeetingState,
  WsClientMessage,
  WsServerMessage,
} from '../types/office.ts';

const EMPTY_MEETING: MeetingState = {
  active: false,
  topic: '',
  participantIds: [],
  cwd: '',
  status: 'idle',
  currentRound: 0,
  maxRounds: 1,
  messages: [],
};

export interface OfficeSocketState {
  connected: boolean;
  defaultCwd: string;
  providers: CliProviderInfo[];
  agents: AgentRecord[];
  meeting: MeetingState;
  lastError: string | null;
  send: (msg: WsClientMessage) => void;
}

export function useOfficeSocket(): OfficeSocketState {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [defaultCwd, setDefaultCwd] = useState('');
  const [providers, setProviders] = useState<CliProviderInfo[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [meeting, setMeeting] = useState<MeetingState>(EMPTY_MEETING);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    let reconnectTimer: number | undefined;

    const scheduleReconnect = () => {
      if (!closed) {
        reconnectTimer = window.setTimeout(connect, 1800);
      }
    };

    const connect = async () => {
      const ok = await ensureSession(true);
      if (closed) return;
      if (!ok) {
        setConnected(false);
        scheduleReconnect();
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setLastError(null);
      };

      ws.onclose = () => {
        setConnected(false);
        clearCachedSession();
        scheduleReconnect();
      };

      ws.onerror = () => {
        setConnected(false);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as WsServerMessage;
          switch (msg.type) {
            case 'snapshot':
              setDefaultCwd(msg.data.defaultCwd);
              setProviders(msg.data.providers);
              setAgents(msg.data.agents);
              setMeeting(msg.data.meeting ?? EMPTY_MEETING);
              break;

            case 'providers_updated':
              setProviders(msg.providers);
              break;

            case 'agent_status':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? { ...a, status: msg.status, currentActivity: msg.currentActivity }
                    : a
                )
              );
              break;

            case 'message_added':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? { ...a, messages: [...a.messages, msg.message] }
                    : a
                )
              );
              break;

            case 'message_chunk':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? {
                        ...a,
                        messages: a.messages.map((m) =>
                          m.id === msg.messageId
                            ? {
                                ...m,
                                content: m.content + msg.chunk,
                                toolActivity: msg.toolActivity ?? m.toolActivity,
                              }
                            : m
                        ),
                      }
                    : a
                )
              );
              break;

            case 'message_done':
              setAgents((prev) =>
                prev.map((a) =>
                  a.id === msg.agentId
                    ? {
                        ...a,
                        messages: a.messages.map((m) =>
                          m.id === msg.messageId
                            ? {
                                ...m,
                                status: msg.status,
                                content: msg.finalContent ?? m.content,
                              }
                            : m
                        ),
                      }
                    : a
                )
              );
              break;

            case 'meeting_updated':
              setMeeting(msg.meeting);
              setLastError(null);
              break;

            case 'meeting_message_added':
              setLastError(null);
              setMeeting((prev) =>
                prev.messages.some((m) => m.id === msg.message.id)
                  ? prev
                  : {
                      ...prev,
                      messages: [...prev.messages, msg.message],
                    }
              );
              break;

            case 'meeting_message_chunk':
              setMeeting((prev) => ({
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === msg.messageId
                    ? {
                        ...m,
                        content: m.content + msg.chunk,
                        toolActivity: msg.toolActivity ?? m.toolActivity,
                      }
                    : m
                ),
              }));
              break;

            case 'meeting_message_done':
              setMeeting((prev) => ({
                ...prev,
                messages: prev.messages.map((m) =>
                  m.id === msg.messageId
                    ? {
                        ...m,
                        status: msg.status,
                        content: msg.finalContent ?? m.content,
                      }
                    : m
                ),
              }));
              break;

            case 'error':
              setLastError(msg.message);
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return {
    connected,
    defaultCwd,
    providers,
    agents,
    meeting,
    lastError,
    send,
  };
}

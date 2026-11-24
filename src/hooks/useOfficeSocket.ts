import { useCallback, useEffect, useRef, useState } from 'react';
import { clearCachedSessionToken, getSessionToken } from '../lib/sessionAuth.ts';
import type {
  AgentRecord,
  CliProviderInfo,
  WsClientMessage,
  WsServerMessage,
} from '../types/office.ts';

export interface OfficeSocketState {
  connected: boolean;
  defaultCwd: string;
  providers: CliProviderInfo[];
  agents: AgentRecord[];
  lastError: string | null;
  send: (msg: WsClientMessage) => void;
}

export function useOfficeSocket(): OfficeSocketState {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [defaultCwd, setDefaultCwd] = useState('');
  const [providers, setProviders] = useState<CliProviderInfo[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
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
      const token = await getSessionToken(true);
      if (closed) return;
      if (!token) {
        setConnected(false);
        scheduleReconnect();
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setLastError(null);
      };

      ws.onclose = () => {
        setConnected(false);
        clearCachedSessionToken();
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
    lastError,
    send,
  };
}

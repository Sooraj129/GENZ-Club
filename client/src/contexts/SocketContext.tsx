/**
 * Real-time updates over Socket.IO.
 *
 * The server pushes an event whenever data changes (session started/expired,
 * payment recorded, ...). We don't apply the payload directly — we mark the
 * matching TanStack Query caches as stale, and any screen showing that data
 * refetches it. One source of truth (the API), no hand-merged state.
 *
 * Debugging: in development every event is logged as  [socket] session:expired {...}
 * Server side, events are emitted from server/src/sockets/index.ts (emitEvent / EventBatch).
 */
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { api } from '../api';
import { API_ORIGIN } from '../api/client';
import { syncServerTime } from '../utils/serverClock';
import { useAuth } from './AuthContext';

/** Server event → query keys that become stale. Keys match the queryKey prefixes used in pages. */
const INVALIDATIONS: Record<string, string[][]> = {
  'session:created': [['sessions'], ['consoles'], ['dashboard']],
  'session:started': [['sessions'], ['consoles'], ['dashboard']],
  'session:updated': [['sessions'], ['dashboard']],
  'session:extended': [['sessions'], ['dashboard']],
  'session:cancelled': [['sessions'], ['consoles'], ['dashboard']],
  'session:paused': [['sessions'], ['consoles'], ['dashboard']],
  'session:resumed': [['sessions'], ['consoles'], ['dashboard']],
  'membership:updated': [['memberships'], ['customers']],
  'session:completed': [['sessions'], ['consoles'], ['invoices'], ['dashboard'], ['customers'], ['memberships']],
  'session:expired': [['sessions'], ['consoles'], ['invoices'], ['dashboard'], ['customers'], ['memberships']],
  'console:updated': [['consoles'], ['dashboard']],
  'invoice:created': [['invoices'], ['dashboard'], ['sessions'], ['memberships']],
  'invoice:updated': [['invoices'], ['dashboard'], ['sessions'], ['memberships']],
  'payment:updated': [['payments'], ['invoices'], ['dashboard'], ['sessions'], ['customers'], ['memberships']],
  'customer:updated': [['customers']],
  'dashboard:updated': [['dashboard'], ['reports']],
};

type ConnectionState = 'connecting' | 'connected' | 'disconnected';
const SocketContext = createContext<{ status: ConnectionState }>({ status: 'connecting' });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConnectionState>('connecting');

  useEffect(() => {
    if (!token) return;
    // Connects to the API server's own port (VITE_API_URL), same as REST calls.
    const socket: Socket = io(API_ORIGIN, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });

    const syncClock = () => {
      const sentAt = Date.now();
      socket.emit('time:sync', (serverIso: string) => syncServerTime(serverIso, sentAt));
    };

    socket.on('connect', () => {
      setStatus('connected');
      if (import.meta.env.DEV) console.info(`[socket] connected to ${API_ORIGIN}`);
      syncClock();
      // Anything may have changed while we were offline — refetch everything visible.
      queryClient.invalidateQueries();
    });
    socket.on('disconnect', (reason) => {
      setStatus('disconnected');
      console.warn(`[socket] disconnected: ${reason}`);
    });
    socket.on('connect_error', (err) => {
      setStatus('disconnected');
      console.warn(`[socket] cannot connect to ${API_ORIGIN}: ${err.message}`);
    });

    for (const [event, keys] of Object.entries(INVALIDATIONS)) {
      socket.on(event, (payload: unknown) => {
        if (import.meta.env.DEV) console.debug(`[socket] ${event}`, payload);
        keys.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
      });
    }
    socket.on('session:expired', () => toast.info('A session reached its end time — invoice generated.'));

    const clockTimer = setInterval(syncClock, 5 * 60_000);
    api.auth.syncTime().catch(() => undefined);

    return () => {
      clearInterval(clockTimer);
      socket.disconnect();
    };
  }, [token, queryClient]);

  return <SocketContext.Provider value={{ status }}>{children}</SocketContext.Provider>;
}

export const useSocketStatus = () => useContext(SocketContext).status;

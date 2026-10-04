import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { authService } from '../services/authService.js';
import { logger } from '../utils/logger.js';

export type ServerEvent =
  | 'session:created'
  | 'session:started'
  | 'session:updated'
  | 'session:extended'
  | 'session:completed'
  | 'session:expired'
  | 'session:cancelled'
  | 'session:paused'
  | 'session:resumed'
  | 'membership:updated'
  | 'console:updated'
  | 'invoice:created'
  | 'invoice:updated'
  | 'payment:updated'
  | 'customer:updated'
  | 'dashboard:updated';

let io: Server | null = null;

export function initSockets(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigins, credentials: true },
  });

  // Only authenticated staff may subscribe to live updates.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Authentication required'));
      socket.data.user = await authService.verifyToken(token);
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug({ user: socket.data.user?.email }, 'Socket connected');
    // Lets the client compute its clock offset against the server for timers.
    socket.on('time:sync', (ack?: (serverTime: string) => void) => {
      if (typeof ack === 'function') ack(new Date().toISOString());
    });
  });

  return io;
}

/** Broadcasts to every connected staff client. No-op before sockets start (e.g. in tests/scripts). */
export function emitEvent(event: ServerEvent, payload: unknown = {}): void {
  io?.emit(event, { ...((payload as object) ?? {}), server_time: new Date().toISOString() });
}

/** Collects events during a transaction and emits them only after commit. */
export class EventBatch {
  private events: Array<[ServerEvent, unknown]> = [];

  add(event: ServerEvent, payload: unknown = {}): this {
    this.events.push([event, payload]);
    return this;
  }

  get size(): number {
    return this.events.length;
  }

  flush(): void {
    for (const [event, payload] of this.events) emitEvent(event, payload);
    this.events = [];
  }
}

export async function closeSockets(): Promise<void> {
  await io?.close();
  io = null;
}

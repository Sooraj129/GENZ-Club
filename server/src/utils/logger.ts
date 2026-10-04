import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: ['req.headers.authorization', '*.password', '*.password_hash', '*.token'],
  transport:
    env.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          // One line per entry, e.g.  [17:05:12] INFO: ← POST /api/sessions 201 42ms {"rid":"…","user":"…"}
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
        }
      : undefined,
});

import type { NextFunction, Request, Response } from 'express';
import { authService } from '../services/authService.js';
import type { AuthUser, Role } from '../types/index.js';
import { forbidden, unauthorized } from '../utils/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    req.user = await authService.verifyToken(header.slice(7));
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** The authenticated user; only call in handlers behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

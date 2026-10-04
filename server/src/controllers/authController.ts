import type { Request, Response } from 'express';
import { currentUser } from '../middleware/auth.js';
import { authService } from '../services/authService.js';
import { userService } from '../services/userService.js';
import { idParamSchema } from '../validators/common.js';
import { createUserSchema, loginSchema, updateUserSchema } from '../validators/schemas.js';
import { ok, parse } from '../utils/http.js';

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = parse(loginSchema, req.body);
    ok(res, await authService.login(email, password));
  },

  // JWTs are stateless; the client discards its token. The endpoint exists so
  // clients have one place to call (and a hook for future token revocation).
  async logout(_req: Request, res: Response) {
    ok(res, { loggedOut: true });
  },

  async me(req: Request, res: Response) {
    ok(res, { user: currentUser(req), server_time: new Date().toISOString() });
  },
};

export const userController = {
  async list(_req: Request, res: Response) {
    ok(res, await userService.list());
  },

  async create(req: Request, res: Response) {
    ok(res, await userService.create(parse(createUserSchema, req.body)), 201);
  },

  async update(req: Request, res: Response) {
    const { id } = parse(idParamSchema, req.params);
    ok(res, await userService.update(currentUser(req).id, id, parse(updateUserSchema, req.body)));
  },
};

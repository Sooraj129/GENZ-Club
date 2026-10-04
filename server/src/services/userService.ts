import { userRepository } from '../repositories/userRepository.js';
import type { Role } from '../types/index.js';
import { badRequest, conflict, isPgError, notFound, PG } from '../utils/errors.js';
import { authService } from './authService.js';

export const userService = {
  list() {
    return userRepository.list();
  },

  async create(input: { name: string; email: string; password: string; role: Role }) {
    try {
      return await userRepository.create({
        name: input.name,
        email: input.email,
        role: input.role,
        passwordHash: await authService.hashPassword(input.password),
      });
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict('A user with this email already exists');
      throw err;
    }
  },

  async update(
    actorId: string,
    id: string,
    input: Partial<{ name: string; email: string; password: string; role: Role; is_active: boolean }>,
  ) {
    const target = await userRepository.findById(id);
    if (!target) throw notFound('User not found');

    // Never let the system end up without an active admin.
    const losesAdmin =
      target.role === 'ADMIN' && target.is_active && (input.role === 'STAFF' || input.is_active === false);
    if (losesAdmin && (await userRepository.countActiveAdmins()) <= 1) {
      throw badRequest('At least one active admin is required');
    }
    if (actorId === id && input.is_active === false) throw badRequest('You cannot deactivate your own account');

    try {
      return await userRepository.update(id, {
        name: input.name,
        email: input.email?.toLowerCase(),
        role: input.role,
        is_active: input.is_active,
        password_hash: input.password ? await authService.hashPassword(input.password) : undefined,
      });
    } catch (err) {
      if (isPgError(err, PG.UNIQUE_VIOLATION)) throw conflict('A user with this email already exists');
      throw err;
    }
  },
};

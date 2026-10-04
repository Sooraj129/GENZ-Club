import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { userRepository } from '../repositories/userRepository.js';
import type { AuthUser, Role } from '../types/index.js';
import { unauthorized } from '../utils/errors.js';

const BCRYPT_ROUNDS = 12;

// A real hash so login takes the same time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', BCRYPT_ROUNDS);

interface TokenPayload {
  sub: string;
  role: Role;
}

export const authService = {
  hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  },

  async login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
    const user = await userRepository.findByEmailWithHash(email);
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || !user.is_active) throw unauthorized('Invalid email or password');

    const authUser: AuthUser = { id: user.id, name: user.name, email: user.email, role: user.role };
    const token = jwt.sign({ sub: user.id, role: user.role } satisfies TokenPayload, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    });
    return { token, user: authUser };
  },

  /**
   * Verifies the token and re-loads the user so deactivated accounts and role
   * changes take effect immediately rather than when the token expires.
   */
  async verifyToken(token: string): Promise<AuthUser> {
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as unknown as TokenPayload;
    } catch {
      throw unauthorized('Invalid or expired session. Please log in again.');
    }
    const user = await userRepository.findById(payload.sub);
    if (!user || !user.is_active) throw unauthorized('Account is no longer active');
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  },
};

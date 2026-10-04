import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { setUnauthorizedHandler, tokenStore } from '../api/client';
import type { User } from '../types';

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(() => Boolean(tokenStore.get()));

  const clear = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => setUnauthorizedHandler(clear), [clear]);

  // Restore the session after a refresh.
  useEffect(() => {
    if (!token || user) return;
    let cancelled = false;
    setLoading(true);
    api.auth
      .me()
      .then(({ user }) => !cancelled && setUser(user))
      .catch(() => !cancelled && clear())
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [token, user, clear]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.auth.login(email, password);
    tokenStore.set(result.token);
    setToken(result.token);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    clear();
  }, [clear]);

  const value = useMemo(
    () => ({ user, token, loading, login, logout, isAdmin: user?.role === 'ADMIN' }),
    [user, token, loading, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

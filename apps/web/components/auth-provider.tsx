'use client';

import { authTokenResponseSchema, authUserSchema, loginInputSchema, type AuthUser } from '@controle/shared';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { apiRequest, ApiError } from '@/lib/api';

type AuthContextValue = {
  token: string | null;
  user: AuthUser | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const STORAGE_TOKEN_KEY = 'controle-estoque.token';
const STORAGE_USER_KEY = 'controle-estoque.user';

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const storedToken = window.localStorage.getItem(STORAGE_TOKEN_KEY);
      const storedUserRaw = window.localStorage.getItem(STORAGE_USER_KEY);
      const parsedUser = storedUserRaw ? authUserSchema.safeParse(JSON.parse(storedUserRaw)) : null;

      if (storedToken) {
        setToken(storedToken);
      }

      if (parsedUser?.success) {
        setUser(parsedUser.data);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_TOKEN_KEY);
      window.localStorage.removeItem(STORAGE_USER_KEY);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || !token) {
      return;
    }

    void apiRequest<{ user: AuthUser }>('/auth/me', { token })
      .then((payload) => {
        const parsed = authUserSchema.safeParse(payload.user);
        if (parsed.success) {
          setUser(parsed.data);
          window.localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(parsed.data));
        }
      })
      .catch(() => {
        setToken(null);
        setUser(null);
        window.localStorage.removeItem(STORAGE_TOKEN_KEY);
        window.localStorage.removeItem(STORAGE_USER_KEY);
      });
  }, [ready, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      ready,
      async login(email: string, password: string) {
        const input = loginInputSchema.parse({ email, password });
        const payload = await apiRequest('/auth/login', {
          method: 'POST',
          body: input,
        });
        const parsed = authTokenResponseSchema.parse(payload);
        setToken(parsed.accessToken);
        setUser(parsed.user);
        window.localStorage.setItem(STORAGE_TOKEN_KEY, parsed.accessToken);
        window.localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(parsed.user));
      },
      logout() {
        setToken(null);
        setUser(null);
        window.localStorage.removeItem(STORAGE_TOKEN_KEY);
        window.localStorage.removeItem(STORAGE_USER_KEY);
      },
      async refreshUser() {
        if (!token) {
          throw new ApiError('Not authenticated', 401);
        }
        const payload = await apiRequest<{ user: AuthUser }>('/auth/me', { token });
        const parsed = authUserSchema.parse(payload.user);
        setUser(parsed);
        window.localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(parsed));
      },
    }),
    [ready, token, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}


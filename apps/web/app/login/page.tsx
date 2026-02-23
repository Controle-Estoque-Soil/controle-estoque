'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { ZodError } from 'zod';

import { useAuth } from '@/components/auth-provider';
import { ApiError } from '@/lib/api';

export default function LoginPage() {
  const { login, token, ready } = useAuth();
  const router = useRouter();
  const [nextPath, setNextPath] = useState('/');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setNextPath(params.get('next') || '/');
    }
  }, []);

  useEffect(() => {
    if (ready && token) {
      router.replace(nextPath);
    }
  }, [nextPath, ready, router, token]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      router.replace(nextPath);
    } catch (caughtError) {
      if (caughtError instanceof ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else if (caughtError instanceof ApiError) {
        setError(caughtError.message);
      } else {
        setError('Falha ao fazer login');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="page-header">
          <div>
            <h1 className="page-title">Entrar</h1>
            <p className="page-subtitle">Acesse a plataforma de controle de estoque.</p>
          </div>
        </div>
        <div className="separator" />
        <form className="grid" onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@example.com"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Senha</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          <div className="actions">
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
          <p className="small">
            Dica: crie o admin inicial via seed (`apps/api/prisma/seed.ts`) ou use `/auth/register` quando não houver usuários.
          </p>
        </form>
      </div>
    </div>
  );
}


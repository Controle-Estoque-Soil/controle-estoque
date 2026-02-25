'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatUserDisplayName } from '@/lib/format';

type UserRecord = {
  id: string;
  name: string | null;
  email: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
};

const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Nome e obrigatorio').max(120, 'Nome invalido'),
  email: z.string().trim().email('Email invalido'),
  password: z.string().min(8, 'Senha deve ter pelo menos 8 caracteres').max(128, 'Senha invalida'),
});

const selfProfileSchema = z.object({
  name: z.string().trim().min(1, 'Nome e obrigatorio').max(120, 'Nome invalido'),
});

const userEditSchema = z
  .object({
    name: z.string().trim().min(1, 'Nome e obrigatorio').max(120, 'Nome invalido'),
    email: z.string().trim().email('Email invalido'),
    password: z.string().trim().max(128, 'Senha invalida').optional(),
  })
  .transform((data) => ({
    ...data,
    password: data.password?.trim() ? data.password.trim() : undefined,
  }));

function emptyCreateForm() {
  return {
    name: '',
    email: '',
    password: '',
  };
}

function emptyEditForm() {
  return {
    name: '',
    email: '',
    password: '',
  };
}

export default function UsersPage() {
  const { token, user, refreshUser } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [editForm, setEditForm] = useState(emptyEditForm());
  const [selfName, setSelfName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isAdmin = user?.role === 'ADMIN';
  const selectedUser = useMemo(
    () => users.find((candidate) => candidate.id === selectedUserId) ?? null,
    [users, selectedUserId],
  );

  useEffect(() => {
    setSelfName(user?.name ?? '');
  }, [user?.name]);

  useEffect(() => {
    if (!token || !isAdmin) {
      return;
    }
    void loadUsers();
  }, [token, isAdmin]);

  async function loadUsers() {
    if (!token || !isAdmin) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<{ data: UserRecord[] }>('/users', { token });
      setUsers(response.data);

      if (selectedUserId) {
        const currentSelected = response.data.find((candidate) => candidate.id === selectedUserId);
        if (!currentSelected) {
          setSelectedUserId(null);
          setEditForm(emptyEditForm());
        } else {
          setEditForm({
            name: currentSelected.name ?? '',
            email: currentSelected.email,
            password: '',
          });
        }
      }
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar usuarios');
    } finally {
      setLoading(false);
    }
  }

  function handleSelectUser(targetUser: UserRecord) {
    setSelectedUserId(targetUser.id);
    setEditForm({
      name: targetUser.name ?? '',
      email: targetUser.email,
      password: '',
    });
    setError(null);
    setSuccess(null);
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !isAdmin) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = createUserSchema.parse(createForm);
      await apiRequest<{ data: UserRecord }>('/users', {
        method: 'POST',
        token,
        body: payload,
      });
      setCreateForm(emptyCreateForm());
      setSuccess('Usuario criado com sucesso.');
      await loadUsers();
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados invalidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao criar usuario');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveOwnName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !isAdmin) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = selfProfileSchema.parse({ name: selfName });
      await apiRequest<{ data: UserRecord }>('/users/me/profile', {
        method: 'PUT',
        token,
        body: payload,
      });
      await refreshUser();
      setSuccess('Seu nome foi atualizado.');
      await loadUsers();
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados invalidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao atualizar seu nome');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !isAdmin || !selectedUser) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const parsed = userEditSchema.parse(editForm);
      await apiRequest<{ data: UserRecord }>(`/users/${selectedUser.id}`, {
        method: 'PUT',
        token,
        body: {
          name: parsed.name,
          email: parsed.email,
          ...(parsed.password ? { password: parsed.password } : {}),
        },
      });
      setSuccess('Usuario atualizado com sucesso.');
      setEditForm((current) => ({ ...current, password: '' }));
      await loadUsers();
      if (selectedUser.id === user?.id) {
        await refreshUser();
      }
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados invalidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao atualizar usuario');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteUser(targetUser: UserRecord) {
    if (!token || !isAdmin) {
      return;
    }

    const confirmed = window.confirm(
      `Excluir o usuario ${formatUserDisplayName(targetUser)}?\n\nA exclusao sera bloqueada se houver auditoria/ordens vinculadas.`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await apiRequest<{ data: UserRecord }>(`/users/${targetUser.id}`, {
        method: 'DELETE',
        token,
      });
      if (selectedUserId === targetUser.id) {
        setSelectedUserId(null);
        setEditForm(emptyEditForm());
      }
      setSuccess('Usuario removido com sucesso.');
      await loadUsers();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao remover usuario');
    } finally {
      setSaving(false);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Controle de usuarios</h1>
              <p className="page-subtitle">
                Admin pode criar, editar e remover contas. Usuarios comuns mantem acesso ao estoque, sem criar contas e sem override negativo.
              </p>
            </div>
          </div>

          {error ? <p className="inline-error">{error}</p> : null}
          {success ? <p className="inline-success">{success}</p> : null}

          {!isAdmin ? (
            <div className="alert-block warn">
              <strong>Acesso restrito:</strong> somente ADMIN pode acessar o controle de usuarios.
            </div>
          ) : null}
        </section>

        {isAdmin ? (
          <>
            <section className="grid two">
              <div className="panel">
                <h2>Meu perfil (admin)</h2>
                <form className="form-grid" onSubmit={handleSaveOwnName}>
                  <div className="field">
                    <label>Nome</label>
                    <input
                      className="input"
                      value={selfName}
                      onChange={(event) => setSelfName(event.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label>Email (somente leitura)</label>
                    <input className="input" value={user?.email ?? ''} readOnly />
                  </div>
                  <div className="actions full">
                    <button type="submit" className="button secondary" disabled={saving}>
                      Salvar meu nome
                    </button>
                  </div>
                </form>
              </div>

              <div className="panel">
                <h2>Criar conta</h2>
                <form className="form-grid" onSubmit={handleCreateUser}>
                  <div className="field">
                    <label>Nome (usuario)</label>
                    <input
                      className="input"
                      value={createForm.name}
                      onChange={(event) => setCreateForm({ ...createForm, name: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Email</label>
                    <input
                      className="input"
                      type="email"
                      value={createForm.email}
                      onChange={(event) => setCreateForm({ ...createForm, email: event.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Senha</label>
                    <input
                      className="input"
                      type="password"
                      value={createForm.password}
                      onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
                    />
                  </div>
                  <div className="actions full">
                    <button type="submit" className="button" disabled={saving}>
                      Criar usuario
                    </button>
                  </div>
                </form>
              </div>
            </section>

            <section className="grid two">
              <div className="panel">
                <div className="page-header">
                  <h2 style={{ margin: 0 }}>Usuarios cadastrados</h2>
                  <button type="button" className="button ghost" onClick={() => void loadUsers()} disabled={loading}>
                    {loading ? 'Atualizando...' : 'Atualizar'}
                  </button>
                </div>

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Nome</th>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Criado em</th>
                        <th>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td colSpan={5}>{loading ? 'Carregando...' : 'Nenhum usuario encontrado.'}</td>
                        </tr>
                      ) : (
                        users.map((row) => {
                          const isSelf = row.id === user?.id;
                          return (
                            <tr key={row.id} className={selectedUserId === row.id ? 'table-row-selected' : undefined}>
                              <td>
                                {formatUserDisplayName(row)}
                                {isSelf ? <div className="small">Voce</div> : null}
                              </td>
                              <td>{row.email}</td>
                              <td>{row.role}</td>
                              <td>{formatDateTime(row.createdAt)}</td>
                              <td>
                                <div className="actions">
                                  <button type="button" className="button ghost compact" onClick={() => handleSelectUser(row)}>
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="button danger compact"
                                    onClick={() => void handleDeleteUser(row)}
                                    disabled={isSelf || saving}
                                  >
                                    Deletar
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="panel">
                <h2>Editar conta</h2>
                {!selectedUser ? (
                  <p className="small">Selecione um usuario na tabela para editar.</p>
                ) : (
                  <form className="form-grid" onSubmit={handleUpdateUser}>
                    <div className="field">
                      <label>Nome</label>
                      <input
                        className="input"
                        value={editForm.name}
                        onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Email</label>
                      <input
                        className="input"
                        type="email"
                        value={editForm.email}
                        onChange={(event) => setEditForm({ ...editForm, email: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Nova senha (opcional)</label>
                      <input
                        className="input"
                        type="password"
                        placeholder="Deixe vazio para manter"
                        value={editForm.password}
                        onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
                      />
                    </div>
                    <div className="field">
                      <label>Role</label>
                      <input className="input" value={selectedUser.role} readOnly />
                    </div>
                    <div className="actions full">
                      <button type="submit" className="button secondary" disabled={saving}>
                        Salvar alteracoes
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </section>
          </>
        ) : null}
      </AppShell>
    </RequireAuth>
  );
}

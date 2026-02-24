'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';
import { itemFormSchema } from '@/lib/schemas';

type ItemRecord = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  qtyOnHand: string;
  minQty: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type ItemDetailResponse = {
  item: ItemRecord;
  movements: Array<{
    id: string;
    deltaQty: string;
    reason: string;
    referenceType: string;
    referenceId: string | null;
    note: string | null;
    createdAt: string;
    createdByUser: { id: string; email: string; role: string };
  }>;
};

function emptyItemForm() {
  return {
    name: '',
    sku: '',
    unit: 'un',
    unitPrice: '0',
    qtyOnHand: '0',
    minQty: '',
    active: true,
  };
}

function promptPositiveQuantity(message: string): string | null {
  const rawValue = window.prompt(message);
  if (rawValue === null) {
    return null;
  }

  const value = rawValue.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(value) || /^0(?:\.0+)?$/.test(value)) {
    throw new Error('Informe uma quantidade decimal maior que zero.');
  }

  return value;
}

export default function ItemsPage() {
  const { token, user } = useAuth();
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ItemDetailResponse | null>(null);
  const [createForm, setCreateForm] = useState(emptyItemForm());
  const [editForm, setEditForm] = useState(emptyItemForm());
  const [adjustForm, setAdjustForm] = useState({ deltaQty: '', note: '', allowNegativeOverride: false });
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);

  async function loadItems() {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const response = await apiRequest<{ data: ItemRecord[] }>(`/items${query}`, { token });
      setItems(response.data);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar itens');
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id: string) {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const response = await apiRequest<ItemDetailResponse>(`/items/${id}/detail`, { token });
      setDetail(response);
      setSelectedItemId(id);
      setEditForm({
        name: response.item.name,
        sku: response.item.sku,
        unit: response.item.unit,
        unitPrice: response.item.unitPrice,
        qtyOnHand: response.item.qtyOnHand,
        minQty: response.item.minQty ?? '',
        active: response.item.active,
      });
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar detalhe do item');
    }
  }

  useEffect(() => {
    void loadItems();
  }, [token]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const parsed = itemFormSchema.parse(createForm);
      await apiRequest<{ data: ItemRecord }>('/items', {
        method: 'POST',
        token,
        body: {
          ...parsed,
          minQty: parsed.minQty === '' ? null : parsed.minQty,
        },
      });
      setCreateForm(emptyItemForm());
      setSuccess('Item criado com sucesso.');
      await loadItems();
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao criar item');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedItemId) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const parsed = itemFormSchema.parse(editForm);
      await apiRequest<{ data: ItemRecord }>(`/items/${selectedItemId}`, {
        method: 'PUT',
        token,
        body: {
          name: parsed.name,
          sku: parsed.sku,
          unit: parsed.unit,
          unitPrice: parsed.unitPrice,
          minQty: parsed.minQty === '' ? null : parsed.minQty,
          active: parsed.active,
        },
      });
      setSuccess('Item atualizado com sucesso.');
      await loadItems();
      await loadDetail(selectedItemId);
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao atualizar item');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string) {
    if (!token) {
      return;
    }
    if (!window.confirm('Deletar tudo do cadastro deste item? (A ação desativa o item)')) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ data: ItemRecord }>(`/items/${id}`, { method: 'DELETE', token });
      setSuccess('Item desativado.');
      if (selectedItemId === id) {
        setDetail(null);
        setSelectedItemId(null);
      }
      await loadItems();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao desativar item');
    }
  }

  async function handleRemoveQuantity(item: ItemRecord) {
    if (!token) {
      return;
    }

    if (user?.role !== 'ADMIN') {
      setError('Apenas ADMIN pode remover quantidade diretamente de um item.');
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      const qty = promptPositiveQuantity(`Remover quantos ${item.unit} de "${item.name}"?`);
      if (!qty) {
        return;
      }

      if (!window.confirm(`Confirmar remoção de ${qty} ${item.unit} do item "${item.name}"?`)) {
        return;
      }

      await apiRequest<{ data: ItemRecord }>(`/items/${item.id}/adjust-stock`, {
        method: 'POST',
        token,
        body: {
          deltaQty: `-${qty}`,
          note: 'Remoção rápida pela lista de itens',
          allowNegativeOverride: false,
        },
      });

      setSuccess(`Quantidade removida do item "${item.name}".`);
      await loadItems();
      if (selectedItemId === item.id) {
        await loadDetail(item.id);
      }
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : (caughtError as Error).message || 'Falha ao remover quantidade');
    }
  }

  async function handleAdjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedItemId) {
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ data: ItemRecord }>(`/items/${selectedItemId}/adjust-stock`, {
        method: 'POST',
        token,
        body: {
          deltaQty: adjustForm.deltaQty,
          note: adjustForm.note || undefined,
          allowNegativeOverride: adjustForm.allowNegativeOverride,
        },
      });
      setSuccess('Ajuste de estoque registrado.');
      setAdjustForm({ deltaQty: '', note: '', allowNegativeOverride: false });
      await loadItems();
      await loadDetail(selectedItemId);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao ajustar estoque');
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
              <h1 className="page-title">Itens / Matéria-prima</h1>
              <p className="page-subtitle">Cadastro, edição e histórico de movimentações por item.</p>
            </div>
            <div className="actions">
              <input
                className="input"
                placeholder="Buscar por nome ou SKU"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="button" className="button ghost" onClick={() => void loadItems()} disabled={loading}>
                {loading ? 'Carregando...' : 'Buscar'}
              </button>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {success ? <p className="inline-success">{success}</p> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>Unidade</th>
                  <th>Preço</th>
                  <th>Estoque</th>
                  <th>Mínimo</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Nenhum item cadastrado.</td>
                  </tr>
                ) : (
                  items.map((item) => {
                    const belowMin = item.minQty && Number(item.qtyOnHand) < Number(item.minQty);
                    return (
                      <tr key={item.id}>
                        <td>{item.name}</td>
                        <td>{item.sku}</td>
                        <td>{item.unit}</td>
                        <td>{formatDecimal(item.unitPrice)}</td>
                        <td>{formatDecimal(item.qtyOnHand)}</td>
                        <td>{item.minQty ? formatDecimal(item.minQty) : '-'}</td>
                        <td>
                          <span className={`badge ${item.active ? 'ok' : 'danger'}`}>
                            {item.active ? 'Ativo' : 'Inativo'}
                          </span>
                          {belowMin ? <span className="badge warn">Abaixo mín.</span> : null}
                        </td>
                        <td>
                          <div className="actions">
                            <button type="button" className="button ghost" onClick={() => void loadDetail(item.id)}>
                              Detalhe
                            </button>
                            {user?.role === 'ADMIN' ? (
                              <button type="button" className="button secondary" onClick={() => void handleRemoveQuantity(item)}>
                                Remover qtd
                              </button>
                            ) : null}
                            <button type="button" className="button danger" onClick={() => void handleDeactivate(item.id)}>
                              Deletar tudo
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
        </section>

        <section className="grid two">
          <div className="panel">
            <h2>Criar item</h2>
            <form className="form-grid" onSubmit={handleCreate}>
              <div className="field">
                <label>Nome</label>
                <input className="input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label>SKU</label>
                <input className="input" value={createForm.sku} onChange={(e) => setCreateForm({ ...createForm, sku: e.target.value })} />
              </div>
              <div className="field">
                <label>Unidade</label>
                <input className="input" value={createForm.unit} onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })} />
              </div>
              <div className="field">
                <label>Preço unitário</label>
                <input className="input" value={createForm.unitPrice} onChange={(e) => setCreateForm({ ...createForm, unitPrice: e.target.value })} />
              </div>
              <div className="field">
                <label>Qtd inicial</label>
                <input className="input" value={createForm.qtyOnHand} onChange={(e) => setCreateForm({ ...createForm, qtyOnHand: e.target.value })} />
              </div>
              <div className="field">
                <label>Estoque mínimo (opcional)</label>
                <input className="input" value={createForm.minQty} onChange={(e) => setCreateForm({ ...createForm, minQty: e.target.value })} />
              </div>
              <div className="field full checkbox-row">
                <input
                  id="create-item-active"
                  type="checkbox"
                  checked={createForm.active}
                  onChange={(e) => setCreateForm({ ...createForm, active: e.target.checked })}
                />
                <label htmlFor="create-item-active">Ativo</label>
              </div>
              <div className="actions full">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? 'Salvando...' : 'Criar item'}
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <h2>Detalhe / editar</h2>
            {!selectedItem || !detail ? (
              <p className="small">Selecione um item na lista para editar e ver o histórico.</p>
            ) : (
              <div className="grid">
                <form className="form-grid" onSubmit={handleUpdate}>
                  <div className="field">
                    <label>Nome</label>
                    <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>SKU</label>
                    <input className="input" value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Unidade</label>
                    <input className="input" value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Preço unitário</label>
                    <input className="input" value={editForm.unitPrice} onChange={(e) => setEditForm({ ...editForm, unitPrice: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Qtd em estoque (somente leitura)</label>
                    <input className="input" value={detail.item.qtyOnHand} readOnly />
                  </div>
                  <div className="field">
                    <label>Estoque mínimo</label>
                    <input className="input" value={editForm.minQty} onChange={(e) => setEditForm({ ...editForm, minQty: e.target.value })} />
                  </div>
                  <div className="field full checkbox-row">
                    <input
                      id="edit-item-active"
                      type="checkbox"
                      checked={editForm.active}
                      onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                    />
                    <label htmlFor="edit-item-active">Ativo</label>
                  </div>
                  <div className="actions full">
                    <button className="button secondary" type="submit" disabled={saving}>
                      {saving ? 'Salvando...' : 'Salvar edição'}
                    </button>
                  </div>
                </form>

                {user?.role === 'ADMIN' ? (
                  <>
                    <div className="separator" />
                    <form className="grid" onSubmit={handleAdjustStock}>
                      <h3>Ajuste manual de estoque (ADMIN)</h3>
                      <div className="form-grid">
                        <div className="field">
                          <label>Delta (ex: 5 ou -2.5)</label>
                          <input
                            className="input"
                            value={adjustForm.deltaQty}
                            onChange={(e) => setAdjustForm({ ...adjustForm, deltaQty: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label>Nota</label>
                          <input className="input" value={adjustForm.note} onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })} />
                        </div>
                        <div className="field full checkbox-row">
                          <input
                            id="allow-negative-override"
                            type="checkbox"
                            checked={adjustForm.allowNegativeOverride}
                            onChange={(e) => setAdjustForm({ ...adjustForm, allowNegativeOverride: e.target.checked })}
                          />
                          <label htmlFor="allow-negative-override">Permitir estoque negativo (override)</label>
                        </div>
                      </div>
                      <div className="actions">
                        <button className="button danger" type="submit" disabled={saving}>
                          Registrar ajuste
                        </button>
                      </div>
                    </form>
                  </>
                ) : null}

                <div className="separator" />
                <div>
                  <h3>Histórico de movimentações</h3>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Quando</th>
                          <th>Delta</th>
                          <th>Motivo</th>
                          <th>Referência</th>
                          <th>Usuário</th>
                          <th>Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.movements.length === 0 ? (
                          <tr>
                            <td colSpan={6}>Sem movimentações.</td>
                          </tr>
                        ) : (
                          detail.movements.map((movement) => (
                            <tr key={movement.id}>
                              <td>{formatDateTime(movement.createdAt)}</td>
                              <td>{formatDecimal(movement.deltaQty)}</td>
                              <td>{movement.reason}</td>
                              <td>{movement.referenceType}{movement.referenceId ? ` / ${movement.referenceId}` : ''}</td>
                              <td>{movement.createdByUser.email}</td>
                              <td>{movement.note ?? '-'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </AppShell>
    </RequireAuth>
  );
}


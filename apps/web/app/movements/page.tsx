'use client';

import { FormEvent, useEffect, useState } from 'react';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';

type ItemOption = { id: string; name: string; sku: string; unit: string; active: boolean };

type MovementRecord = {
  id: string;
  itemId: string;
  deltaQty: string;
  reason: string;
  referenceType: string;
  referenceId: string | null;
  note: string | null;
  createdAt: string;
  item: { id: string; name: string; sku: string; unit: string };
  createdByUser: { id: string; email: string; role: string };
};

function toIsoOrUndefined(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export default function MovementsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [filters, setFilters] = useState({ itemId: '', reason: '', from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadItems() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ItemOption[] }>('/items', { token });
    setItems(response.data);
  }

  async function loadMovements() {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.itemId) params.set('itemId', filters.itemId);
      if (filters.reason) params.set('reason', filters.reason);
      const from = toIsoOrUndefined(filters.from);
      const to = toIsoOrUndefined(filters.to);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const query = params.toString() ? `?${params.toString()}` : '';
      const response = await apiRequest<{ data: MovementRecord[] }>(`/movements${query}`, { token });
      setMovements(response.data);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar movimentações');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }
    Promise.all([loadItems(), loadMovements()]).catch((caughtError) => {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar dados');
    });
  }, [token]);

  async function handleFilterSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadMovements();
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Movimentações (auditoria)</h1>
              <p className="page-subtitle">Filtre por item, motivo e período.</p>
            </div>
          </div>
          <form className="grid" onSubmit={handleFilterSubmit}>
            <div className="form-grid">
              <div className="field">
                <label>Item</label>
                <select className="select" value={filters.itemId} onChange={(e) => setFilters({ ...filters, itemId: e.target.value })}>
                  <option value="">Todos</option>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Motivo</label>
                <select className="select" value={filters.reason} onChange={(e) => setFilters({ ...filters, reason: e.target.value })}>
                  <option value="">Todos</option>
                  <option value="MANUAL_ADJUSTMENT">MANUAL_ADJUSTMENT</option>
                  <option value="PRODUCT_INBOUND">PRODUCT_INBOUND</option>
                  <option value="PRODUCT_OUTBOUND">PRODUCT_OUTBOUND</option>
                </select>
              </div>
              <div className="field">
                <label>De</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Até</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                />
              </div>
            </div>
            <div className="actions">
              <button type="submit" className="button ghost" disabled={loading}>
                {loading ? 'Filtrando...' : 'Aplicar filtros'}
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  setFilters({ itemId: '', reason: '', from: '', to: '' });
                  setTimeout(() => void loadMovements(), 0);
                }}
              >
                Limpar
              </button>
            </div>
          </form>
          {error ? <p className="inline-error">{error}</p> : null}
        </section>

        <section className="panel">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Item</th>
                  <th>Delta</th>
                  <th>Motivo</th>
                  <th>Referência</th>
                  <th>Usuário</th>
                  <th>Nota</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>Carregando...</td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Nenhuma movimentação encontrada.</td>
                  </tr>
                ) : (
                  movements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatDateTime(movement.createdAt)}</td>
                      <td>
                        {movement.item.name}
                        <div className="small">{movement.item.sku}</div>
                      </td>
                      <td>{formatDecimal(movement.deltaQty)} {movement.item.unit}</td>
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
        </section>
      </AppShell>
    </RequireAuth>
  );
}


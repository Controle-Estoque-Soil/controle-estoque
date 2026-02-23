'use client';

import { useEffect, useState } from 'react';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';

type ItemRecord = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  qtyOnHand: string;
  minQty: string | null;
  active: boolean;
};

type MovementRecord = {
  id: string;
  item: { id: string; name: string; sku: string; unit: string };
  deltaQty: string;
  reason: string;
  createdAt: string;
  createdByUser: { email: string };
};

export default function DashboardPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [belowMin, setBelowMin] = useState<ItemRecord[]>([]);
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    Promise.all([
      apiRequest<{ data: ItemRecord[] }>('/items', { token, signal: controller.signal }),
      apiRequest<{ data: ItemRecord[] }>('/items?belowMin=true', { token, signal: controller.signal }),
      apiRequest<{ data: MovementRecord[] }>('/movements', { token, signal: controller.signal }),
    ])
      .then(([itemsResponse, belowMinResponse, movementsResponse]) => {
        setItems(itemsResponse.data);
        setBelowMin(belowMinResponse.data);
        setMovements(movementsResponse.data.slice(0, 10));
      })
      .catch((caughtError) => {
        if (caughtError instanceof ApiError) {
          setError(caughtError.message);
          return;
        }
        if ((caughtError as Error).name !== 'AbortError') {
          setError('Falha ao carregar dashboard');
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [token]);

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Dashboard</h1>
              <p className="page-subtitle">Visão rápida do estoque e últimas movimentações.</p>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {loading ? <p className="small">Carregando...</p> : null}
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="card-value">{items.length}</div>
              <div className="card-label">Itens cadastrados</div>
            </div>
            <div className="kpi-card">
              <div className="card-value">{belowMin.length}</div>
              <div className="card-label">Itens abaixo do mínimo</div>
            </div>
            <div className="kpi-card">
              <div className="card-value">{movements.length}</div>
              <div className="card-label">Últimas movimentações</div>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Últimas movimentações</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Item</th>
                  <th>Delta</th>
                  <th>Motivo</th>
                  <th>Usuário</th>
                </tr>
              </thead>
              <tbody>
                {movements.length === 0 ? (
                  <tr>
                    <td colSpan={5}>Nenhuma movimentação registrada.</td>
                  </tr>
                ) : (
                  movements.map((movement) => (
                    <tr key={movement.id}>
                      <td>{formatDateTime(movement.createdAt)}</td>
                      <td>
                        <strong>{movement.item.name}</strong>
                        <div className="small">{movement.item.sku}</div>
                      </td>
                      <td>{formatDecimal(movement.deltaQty)} {movement.item.unit}</td>
                      <td>{movement.reason}</td>
                      <td>{movement.createdByUser.email}</td>
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


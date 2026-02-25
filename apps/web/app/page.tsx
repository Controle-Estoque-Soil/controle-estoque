'use client';

import { useEffect, useState } from 'react';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { ProductOrderDetailModal } from '@/components/product-order-detail-modal';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal, formatUserDisplayName } from '@/lib/format';

type ItemRecord = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  qtyOnHand: string;
  minQty: string | null;
};

type OrderListRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productQty: string;
  totalCost: string;
  unitCost: string;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  createdByUser: { id: string; name?: string | null; email: string; role: string };
  linesCount: number;
};

type OrderDetailRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productId: string;
  productQty: string;
  totalCost: string;
  unitCost: string;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  createdByUser: { id: string; name?: string | null; email: string; role: string };
  lines: Array<{
    id: string;
    itemId: string;
    itemQty: string;
    itemUnitPriceSnapshot: string;
    lineCost: string;
    item: { id: string; name: string; sku: string; unit: string };
  }>;
};

function formatProductOperationType(type: OrderListRecord['type'] | OrderDetailRecord['type']): string {
  return type === 'OUTBOUND_PRODUCT' ? 'Saida de produto' : 'Chegada de produto';
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [belowMin, setBelowMin] = useState<ItemRecord[]>([]);
  const [recentOperations, setRecentOperations] = useState<OrderListRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadOrderDetail(orderId: string) {
    if (!token) {
      return;
    }

    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await apiRequest<{ data: OrderDetailRecord }>(`/operations/${orderId}`, { token });
      setSelectedOrder(response.data);
    } catch (caughtError) {
      setDetailError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar detalhes da operacao');
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setDetailError(null);

    Promise.all([
      apiRequest<{ data: ItemRecord[] }>('/items', { token, signal: controller.signal }),
      apiRequest<{ data: ItemRecord[] }>('/items?belowMin=true', { token, signal: controller.signal }),
      apiRequest<{ data: OrderListRecord[] }>('/operations', { token, signal: controller.signal }),
    ])
      .then(([itemsResponse, belowMinResponse, operationsResponse]) => {
        setItems(itemsResponse.data);
        setBelowMin(belowMinResponse.data);
        setRecentOperations(operationsResponse.data.slice(0, 10));
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

  function closeOrderDetailModal() {
    setSelectedOrder(null);
    setDetailError(null);
    setDetailLoading(false);
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Dashboard</h1>
              <p className="page-subtitle">Visao rapida do estoque e ultimas operacoes de produto.</p>
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
              <div className="card-label">Itens abaixo do minimo</div>
            </div>
            <div className="kpi-card">
              <div className="card-value">{recentOperations.length}</div>
              <div className="card-label">Ultimas operacoes de produto</div>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Ultimas movimentacoes de produto</h2>
          <p className="small">
            Cada linha representa uma operacao de produto. Clique em "Exibir detalhes" para ver os itens que sairam/chegaram.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Produto</th>
                  <th>Delta</th>
                  <th>Motivo</th>
                  <th>Itens</th>
                  <th>Usuario</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {recentOperations.length === 0 ? (
                  <tr>
                    <td colSpan={7}>Nenhuma operacao de produto registrada.</td>
                  </tr>
                ) : (
                  recentOperations.map((operation) => (
                    <tr key={operation.id} className={selectedOrder?.id === operation.id ? 'table-row-selected' : undefined}>
                      <td>{formatDateTime(operation.createdAt)}</td>
                      <td>
                        <strong>{operation.product.name}</strong>
                        <div className="small">{operation.product.sku}</div>
                      </td>
                      <td>
                        {operation.type === 'OUTBOUND_PRODUCT' ? '-' : '+'}
                        {formatDecimal(operation.productQty)} un
                      </td>
                      <td>{formatProductOperationType(operation.type)}</td>
                      <td>{operation.linesCount}</td>
                      <td>{formatUserDisplayName(operation.createdByUser)}</td>
                      <td>
                        <button
                          type="button"
                          className="button ghost"
                          onClick={() => void loadOrderDetail(operation.id)}
                        >
                          Exibir detalhes
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

        </section>
        <ProductOrderDetailModal
          open={detailLoading || Boolean(detailError) || Boolean(selectedOrder)}
          title="Detalhes da movimentacao selecionada"
          loading={detailLoading}
          error={detailError}
          order={selectedOrder}
          onClose={closeOrderDetailModal}
        />
      </AppShell>
    </RequireAuth>
  );
}

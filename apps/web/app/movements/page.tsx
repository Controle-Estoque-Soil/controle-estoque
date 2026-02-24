'use client';

import { FormEvent, useEffect, useState } from 'react';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';

type ItemOption = { id: string; name: string; sku: string; unit: string };

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

type OrderDetailRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productQty: string;
  totalCost: string;
  unitCost: string;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  createdByUser: { id: string; email: string; role: string };
  lines: Array<{
    id: string;
    itemId: string;
    itemQty: string;
    itemUnitPriceSnapshot: string;
    lineCost: string;
    item: { id: string; name: string; sku: string; unit: string };
  }>;
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

function canOpenOrderDetail(movement: MovementRecord): boolean {
  return movement.referenceType === 'PRODUCT_ORDER' && Boolean(movement.referenceId);
}

function isStandaloneItemMovement(movement: MovementRecord): boolean {
  if (movement.referenceType !== 'MANUAL_ADJUSTMENT') {
    return false;
  }

  if (movement.note?.startsWith('[ITEM_DIRETO_')) {
    return true;
  }

  return Number(movement.deltaQty) < 0;
}

function movementSourceLabel(movement: MovementRecord): string {
  if (canOpenOrderDetail(movement)) {
    return 'Produto';
  }
  if (isStandaloneItemMovement(movement)) {
    return 'Item direto';
  }
  if (movement.referenceType === 'MANUAL_ADJUSTMENT') {
    return 'Ajuste manual';
  }
  return movement.referenceType;
}

export default function MovementsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [filters, setFilters] = useState({ itemId: '', reason: '', from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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

      if (selectedMovementId && !response.data.some((movement) => movement.id === selectedMovementId)) {
        setSelectedMovementId(null);
        setSelectedOrder(null);
        setDetailError(null);
      }
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar movimentacoes');
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

  async function openMovementDetail(movement: MovementRecord) {
    if (!token || !canOpenOrderDetail(movement) || !movement.referenceId) {
      return;
    }

    setSelectedMovementId(movement.id);
    setSelectedOrder(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const response = await apiRequest<{ data: OrderDetailRecord }>(`/operations/${movement.referenceId}`, { token });
      setSelectedOrder(response.data);
    } catch (caughtError) {
      setDetailError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar itens da operacao');
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Movimentacoes (auditoria)</h1>
              <p className="page-subtitle">
                Filtre por item, motivo e periodo. Clique em uma movimentacao de produto para ver os itens da ordem.
              </p>
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
                <label>Ate</label>
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
                  setSelectedMovementId(null);
                  setSelectedOrder(null);
                  setDetailError(null);
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
                  <th>Referencia</th>
                  <th>Usuario</th>
                  <th>Nota</th>
                  <th>Origem</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9}>Carregando...</td>
                  </tr>
                ) : movements.length === 0 ? (
                  <tr>
                    <td colSpan={9}>Nenhuma movimentacao encontrada.</td>
                  </tr>
                ) : (
                  movements.map((movement) => {
                    const isOrderMovement = canOpenOrderDetail(movement);
                    return (
                      <tr
                        key={movement.id}
                        className={selectedMovementId === movement.id ? 'table-row-selected' : undefined}
                        onClick={isOrderMovement ? () => void openMovementDetail(movement) : undefined}
                        style={isOrderMovement ? { cursor: 'pointer' } : undefined}
                        title={isOrderMovement ? 'Clique para ver os itens da operacao' : undefined}
                      >
                        <td>{formatDateTime(movement.createdAt)}</td>
                        <td>
                          {movement.item.name}
                          <div className="small">{movement.item.sku}</div>
                        </td>
                        <td>
                          {formatDecimal(movement.deltaQty)} {movement.item.unit}
                        </td>
                        <td>{movement.reason}</td>
                        <td>
                          {movement.referenceType}
                          {movement.referenceId ? ` / ${movement.referenceId}` : ''}
                        </td>
                        <td>{movement.createdByUser.email}</td>
                        <td>
                          {movement.note ?? '-'}
                          {isStandaloneItemMovement(movement) ? (
                            <div className="small" style={{ color: '#166534' }}>Saida/entrada de item fora de produto</div>
                          ) : null}
                        </td>
                        <td>
                          <span className={`badge ${canOpenOrderDetail(movement) ? 'ok' : isStandaloneItemMovement(movement) ? 'warn' : ''}`}>
                            {movementSourceLabel(movement)}
                          </span>
                        </td>
                        <td>
                          {isOrderMovement ? (
                            <button
                              type="button"
                              className="button ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                void openMovementDetail(movement);
                              }}
                            >
                              Ver itens
                            </button>
                          ) : (
                            <span className="small">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {(detailLoading || detailError || selectedOrder) ? (
            <div className="grid" style={{ marginTop: '1rem' }}>
              <div className="separator" />
              <h3>Detalhe da movimentacao selecionada</h3>
              {detailLoading ? <p className="small">Carregando itens da operacao...</p> : null}
              {detailError ? <p className="inline-error">{detailError}</p> : null}
              {selectedOrder ? (
                <>
                  <p className="small">
                    {selectedOrder.type} | {selectedOrder.product.name} ({selectedOrder.product.sku}) | qtd{' '}
                    {formatDecimal(selectedOrder.productQty)} | custo total {formatDecimal(selectedOrder.totalCost)} |{' '}
                    {formatDateTime(selectedOrder.createdAt)}
                  </p>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Qtd</th>
                          <th>Preco snapshot</th>
                          <th>Custo linha</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedOrder.lines.map((line) => (
                          <tr key={line.id}>
                            <td>
                              {line.item.name}
                              <div className="small">{line.item.sku}</div>
                            </td>
                            <td>
                              {formatDecimal(line.itemQty)} {line.item.unit}
                            </td>
                            <td>{formatDecimal(line.itemUnitPriceSnapshot)}</td>
                            <td>{formatDecimal(line.lineCost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </AppShell>
    </RequireAuth>
  );
}

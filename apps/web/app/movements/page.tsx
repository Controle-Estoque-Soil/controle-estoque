'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { ProductOrderDetailModal } from '@/components/product-order-detail-modal';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal, formatMovementReason, formatUserDisplayName } from '@/lib/format';

type ItemOption = { id: string; name: string; sku: string; unit: string };

type MovementRecord = {
  id: string;
  itemId: string;
  deltaQty: string;
  reason: string;
  referenceType: string;
  referenceId: string | null;
  reversalOfMovementId: string | null;
  isReversal: boolean;
  isUndone: boolean;
  reversalMovementId: string | null;
  note: string | null;
  createdAt: string;
  item: { id: string; name: string; sku: string; unit: string };
  createdByUser: { id: string; name?: string | null; email: string; role: string };
  productOrder: null | {
    id: string;
    type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
    productQty: string;
    reversalOfOrderId: string | null;
    isReversal: boolean;
    isUndone: boolean;
    reversalOrderId: string | null;
    product: { id: string; name: string; sku: string };
  };
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

type MovementDisplayRow = {
  key: string;
  rowType: 'product' | 'item';
  movement: MovementRecord;
};

type ParsedMovementNote = {
  displayNote: string | null;
  sourceText: string | null;
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

function parseMovementNote(note: string | null): ParsedMovementNote {
  if (!note) {
    return { displayNote: null, sourceText: null };
  }

  const raw = note.trim().replace(/^\[ITEM_DIRETO_[A-Z_]+\]\s*/i, '').trim();
  if (!raw) {
    return { displayNote: null, sourceText: null };
  }

  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  const normalizedParts = parts.length > 0 ? parts : [raw];
  let sourceText: string | null = null;
  const noteParts: string[] = [];

  for (const part of normalizedParts) {
    if (/^Origem:\s*/i.test(part)) {
      const value = part.replace(/^Origem:\s*/i, '').trim();
      if (value && !sourceText) {
        sourceText = value;
      }
      continue;
    }

    noteParts.push(part);
  }

  return {
    displayNote: noteParts.length > 0 ? noteParts.join(' | ') : null,
    sourceText,
  };
}

function shouldHideUndoneMovementRow(movement: MovementRecord): boolean {
  if (movement.productOrder) {
    return Boolean(movement.productOrder.isUndone || movement.productOrder.isReversal);
  }

  return Boolean(movement.isUndone || movement.isReversal);
}

export default function MovementsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [filters, setFilters] = useState({ itemId: '', reason: '', reference: '', from: '', to: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [undoingKey, setUndoingKey] = useState<string | null>(null);

  const displayRows = useMemo<MovementDisplayRow[]>(() => {
    const rows: MovementDisplayRow[] = [];
    const seenProductOrderRefs = new Set<string>();

    for (const movement of movements) {
      if (shouldHideUndoneMovementRow(movement)) {
        continue;
      }

      if (movement.productOrder && movement.referenceId) {
        const key = `PRODUCT_ORDER:${movement.referenceId}`;
        if (seenProductOrderRefs.has(key)) {
          continue;
        }
        seenProductOrderRefs.add(key);
        rows.push({ key, rowType: 'product', movement });
      } else {
        rows.push({ key: movement.id, rowType: 'item', movement });
      }
    }

    return rows;
  }, [movements]);

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
      if (filters.reference.trim()) params.set('reference', filters.reference.trim());
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

  async function handleUndoMovement(row: MovementDisplayRow) {
    if (!token) {
      return;
    }

    const movement = row.movement;
    const label =
      row.rowType === 'product' && movement.productOrder
        ? `${movement.productOrder.product.name} (${formatDecimal(movement.productOrder.productQty)} un)`
        : `${movement.item.name} (${formatDecimal(movement.deltaQty)} ${movement.item.unit})`;

    const confirmed = window.confirm(
      `Desfazer esta movimentacao?\n\n${label}\n\nIsso vai criar uma reversao de auditoria e ajustar o estoque.`,
    );
    if (!confirmed) {
      return;
    }

    setUndoingKey(row.key);
    setError(null);
    setDetailError(null);

    try {
      await apiRequest(`/movements/${movement.id}/undo`, {
        method: 'POST',
        token,
      });

      if (selectedMovementId === movement.id) {
        setSelectedMovementId(null);
        setSelectedOrder(null);
      }

      await loadMovements();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao desfazer movimentacao');
    } finally {
      setUndoingKey(null);
    }
  }

  function closeDetailModal() {
    setSelectedMovementId(null);
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
                  <option value="MANUAL_ADJUSTMENT">Saida/Chegada de item</option>
                  <option value="PRODUCT_INBOUND">Chegada de produto</option>
                  <option value="PRODUCT_OUTBOUND">Saida de produto</option>
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

              <div className="field full">
                <label>Referência</label>
                <input
                  className="input"
                  placeholder="Ex.: MOV-..., cmm..."
                  value={filters.reference}
                  onChange={(e) => setFilters({ ...filters, reference: e.target.value })}
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
                  setFilters({ itemId: '', reason: '', reference: '', from: '', to: '' });
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
                  <th>Movimentação</th>
                  <th>Delta</th>
                  <th>Motivo</th>
                  <th>Referencia</th>
                  <th>Usuario</th>
                  <th>Nota</th>
                  <th>Origem</th>
                  <th>Detalhe</th>
                  <th>Desfazer</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={10}>Carregando...</td>
                  </tr>
                ) : displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={10}>Nenhuma movimentacao encontrada.</td>
                  </tr>
                ) : (
                  displayRows.map((row) => {
                    const movement = row.movement;
                    const parsedNote = parseMovementNote(movement.note);
                    const isOrderMovement = canOpenOrderDetail(movement);
                    const isProductRow = row.rowType === 'product' && movement.productOrder != null;
                    const isReversalRow = isProductRow ? Boolean(movement.productOrder?.isReversal) : Boolean(movement.isReversal);
                    const isAlreadyUndone = isProductRow ? Boolean(movement.productOrder?.isUndone) : Boolean(movement.isUndone);
                    const canUndo = !isReversalRow && !isAlreadyUndone;
                    return (
                      <tr
                        key={row.key}
                        className={selectedMovementId === movement.id ? 'table-row-selected' : undefined}
                        onClick={isOrderMovement ? () => void openMovementDetail(movement) : undefined}
                        style={isOrderMovement ? { cursor: 'pointer' } : undefined}
                        title={isOrderMovement ? 'Clique para ver os itens da operacao' : undefined}
                      >
                        <td>{formatDateTime(movement.createdAt)}</td>
                        <td>
                          {isProductRow ? (
                            <>
                              {movement.productOrder!.product.name}
                              <div className="small">{movement.productOrder!.product.sku}</div>
                            </>
                          ) : (
                            <>
                              {movement.item.name}
                              <div className="small">{movement.item.sku}</div>
                            </>
                          )}
                        </td>
                        <td>
                          {isProductRow ? (
                            <>
                              {movement.productOrder!.type === 'OUTBOUND_PRODUCT' ? '-' : '+'}{formatDecimal(movement.productOrder!.productQty)} un
                            </>
                          ) : (
                            <>
                              {formatDecimal(movement.deltaQty)} {movement.item.unit}
                            </>
                          )}
                        </td>
                        <td>{formatMovementReason(movement.reason, movement.deltaQty)}</td>
                        <td>{movement.referenceId ?? movement.id}</td>
                        <td>{formatUserDisplayName(movement.createdByUser)}</td>
                        <td>
                          {parsedNote.displayNote ?? '-'}
                          {isStandaloneItemMovement(movement) && parsedNote.displayNote ? (
                            <div className="small" style={{ color: '#166534' }}>Saida/entrada de item fora de produto</div>
                          ) : null}
                        </td>
                        <td>
                          {parsedNote.sourceText ? (
                            parsedNote.sourceText
                          ) : (
                            <span className={`badge ${canOpenOrderDetail(movement) ? 'ok' : isStandaloneItemMovement(movement) ? 'warn' : ''}`}>
                              {movementSourceLabel(movement)}
                            </span>
                          )}
                        </td>
                        <td>
                          {isOrderMovement ? (
                            <button
                              type="button"
                              className="button ghost compact"
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
                        <td>
                          {isReversalRow ? (
                            <span className="small">Reversao</span>
                          ) : isAlreadyUndone ? (
                            <span className="small" style={{ color: '#166534', fontWeight: 600 }}>Desfeito</span>
                          ) : canUndo ? (
                            <button
                              type="button"
                              className="button ghost compact"
                              disabled={undoingKey === row.key}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleUndoMovement(row);
                              }}
                            >
                              {undoingKey === row.key ? 'Desfazendo...' : 'Desfazer'}
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

        </section>
        <ProductOrderDetailModal
          open={detailLoading || Boolean(detailError) || Boolean(selectedOrder)}
          title="Detalhe da movimentacao selecionada"
          loading={detailLoading}
          error={detailError}
          order={selectedOrder}
          onClose={closeDetailModal}
        />
      </AppShell>
    </RequireAuth>
  );
}

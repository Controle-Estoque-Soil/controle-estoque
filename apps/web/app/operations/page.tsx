'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';
import { itemOperationFormSchema, operationFormSchema } from '@/lib/schemas';

type ProductOption = { id: string; name: string; sku: string };
type ItemOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  qtyOnHand: string;
  minQty: string | null;
};

type ProductOperationPreviewResponse = {
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  product: { id: string; name: string; sku: string };
  productQty: string;
  totalCost: string;
  unitCost: string;
  canExecute: boolean;
  shortages: Array<{ itemId: string; itemName: string; requiredQty: string; availableQty: string }>;
  lines: Array<{
    itemId: string;
    itemName: string;
    itemSku: string;
    itemUnit: string;
    itemQty: string;
    itemUnitPriceSnapshot: string;
    lineCost: string;
    currentQtyOnHand: string;
    nextQtyOnHand: string;
  }>;
};

type ProductMinWarning = {
  itemId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  minQty: string;
  nextQtyOnHand: string;
};

type ItemOperationPreview = {
  itemId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  qty: string;
  deltaQty: string;
  currentQtyOnHand: string;
  nextQtyOnHand: string;
  minQty: string | null;
  unitPrice: string;
  estimatedCost: string;
  canExecute: boolean;
  requiresAdmin: boolean;
  negativeBlocked: boolean;
  minWarning: boolean;
};

type OrderListRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productQty: string;
  totalCost: string;
  unitCost: string;
  createdAt: string;
  note: string | null;
  product: { id: string; name: string; sku: string };
  createdByUser: { id: string; email: string; role: string };
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

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isAtOrBelowMin(nextQty: string, minQty: string | null | undefined): boolean {
  const next = toNumber(nextQty);
  const min = toNumber(minQty ?? null);
  if (next == null || min == null) {
    return false;
  }
  return next <= min;
}

function isNegativeValue(value: string): boolean {
  const parsed = toNumber(value);
  return parsed != null && parsed < 0;
}

function buildSignedDelta(mode: 'outbound' | 'inbound', qty: string): string {
  return mode === 'outbound' ? `-${qty}` : qty;
}

export default function OperationsPage() {
  const { token, user } = useAuth();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [orders, setOrders] = useState<OrderListRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [mode, setMode] = useState<'outbound' | 'inbound'>('outbound');
  const [target, setTarget] = useState<'product' | 'item'>('product');
  const [productForm, setProductForm] = useState({ productId: '', qty: '', note: '', allowNegativeOverride: false });
  const [itemForm, setItemForm] = useState({ itemId: '', qty: '', note: '', allowNegativeOverride: false });
  const [productPreview, setProductPreview] = useState<ProductOperationPreviewResponse | null>(null);
  const [itemPreview, setItemPreview] = useState<ItemOperationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningPreview, setRunningPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const productMinWarnings = useMemo<ProductMinWarning[]>(() => {
    if (!productPreview) {
      return [];
    }

    return productPreview.lines.flatMap((line) => {
      const item = itemsById.get(line.itemId);
      if (!item?.minQty) {
        return [];
      }
      if (!isAtOrBelowMin(line.nextQtyOnHand, item.minQty)) {
        return [];
      }
      return [
        {
          itemId: line.itemId,
          itemName: line.itemName,
          itemSku: line.itemSku,
          itemUnit: line.itemUnit,
          minQty: item.minQty,
          nextQtyOnHand: line.nextQtyOnHand,
        },
      ];
    });
  }, [itemsById, productPreview]);

  const productMinWarningIds = useMemo(
    () => new Set(productMinWarnings.map((warning) => warning.itemId)),
    [productMinWarnings],
  );

  async function loadProducts() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ProductOption[] }>('/products', { token });
    setProducts(response.data);
  }

  async function loadItems() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ItemOption[] }>('/items', { token });
    setItems(response.data);
  }

  async function loadOrders() {
    if (!token) {
      return;
    }
    setLoading(true);
    try {
      const response = await apiRequest<{ data: OrderListRecord[] }>('/operations', { token });
      setOrders(response.data);
    } finally {
      setLoading(false);
    }
  }

  async function loadOrderDetail(orderId: string) {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<{ data: OrderDetailRecord }>(`/operations/${orderId}`, { token });
      setSelectedOrder(response.data);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar detalhe da ordem');
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    setError(null);
    Promise.all([loadProducts(), loadItems(), loadOrders()]).catch((caughtError) => {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar dados de operacoes');
    });
  }, [token]);

  function resetMessagesAndPreview() {
    setError(null);
    setSuccess(null);
    setProductPreview(null);
    setItemPreview(null);
  }

  async function handleProductPreview() {
    if (!token) {
      return;
    }

    const payload = operationFormSchema.parse(productForm);
    const endpoint = mode === 'outbound' ? '/operations/outbound/preview' : '/operations/inbound/preview';
    const response = await apiRequest<ProductOperationPreviewResponse>(endpoint, {
      method: 'POST',
      token,
      body: payload,
    });
    setProductPreview(response);
    setItemPreview(null);
  }

  function buildItemPreview(): ItemOperationPreview {
    const payload = itemOperationFormSchema.parse(itemForm);
    const item = items.find((candidate) => candidate.id === payload.itemId);
    if (!item) {
      throw new ApiError('Item nao encontrado na lista atual', 400);
    }
    const qty = Number(payload.qty);
    const currentQty = Number(item.qtyOnHand);
    const signedDelta = mode === 'outbound' ? -qty : qty;
    const nextQty = currentQty + signedDelta;
    const requiresAdmin = user?.role !== 'ADMIN';
    const negativeBlocked = nextQty < 0 && !payload.allowNegativeOverride;
    const canExecute = !requiresAdmin && !negativeBlocked;
    const minWarning = item.minQty != null && nextQty <= Number(item.minQty);
    const estimatedCost = (qty * Number(item.unitPrice)).toString();

    return {
      itemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      itemUnit: item.unit,
      qty: payload.qty,
      deltaQty: signedDelta.toString(),
      currentQtyOnHand: item.qtyOnHand,
      nextQtyOnHand: nextQty.toString(),
      minQty: item.minQty,
      unitPrice: item.unitPrice,
      estimatedCost,
      canExecute,
      requiresAdmin,
      negativeBlocked,
      minWarning,
    };
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    resetMessagesAndPreview();
    setRunningPreview(true);

    try {
      if (target === 'product') {
        await handleProductPreview();
      } else {
        setItemPreview(buildItemPreview());
      }
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados invalidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao gerar preview');
      }
    } finally {
      setRunningPreview(false);
    }
  }

  async function executeProductOperation() {
    if (!token || !productPreview) {
      return;
    }

    const payload = operationFormSchema.parse(productForm);
    const endpoint = mode === 'outbound' ? '/operations/outbound' : '/operations/inbound';
    const response = await apiRequest<{ data: OrderDetailRecord }>(endpoint, {
      method: 'POST',
      token,
      body: payload,
    });
    setSuccess('Operacao registrada com sucesso.');
    setSelectedOrder(response.data);
    setProductPreview(null);
    await Promise.all([loadOrders(), loadItems()]);
  }

  async function executeItemOperation() {
    if (!token || !itemPreview) {
      return;
    }
    if (user?.role !== 'ADMIN') {
      throw new ApiError('Somente ADMIN pode movimentar item diretamente por esta tela', 403);
    }

    const payload = itemOperationFormSchema.parse(itemForm);
    await apiRequest<{ data: ItemOption }>(`/items/${payload.itemId}/adjust-stock`, {
      method: 'POST',
      token,
      body: {
        deltaQty: buildSignedDelta(mode, payload.qty),
        note: `[ITEM_DIRETO_${mode.toUpperCase()}] ${payload.note.trim()}`,
        allowNegativeOverride: payload.allowNegativeOverride,
      },
    });

    setSuccess('Movimentacao de item registrada com sucesso.');
    setItemPreview(null);
    await loadItems();
  }

  async function handleExecute() {
    if (!token) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (target === 'product') {
        await executeProductOperation();
      } else {
        await executeItemOperation();
      }
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados invalidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao registrar operacao');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const selectedItemForForm = itemForm.itemId ? itemsById.get(itemForm.itemId) ?? null : null;
  const canConfirm =
    target === 'product'
      ? Boolean(productPreview && productPreview.canExecute && !submitting)
      : Boolean(itemPreview && itemPreview.canExecute && !submitting);

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Operacoes</h1>
              <p className="page-subtitle">Registrar saida/entrada de produto com preview e custo calculado.</p>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {success ? <p className="inline-success">{success}</p> : null}
          <form className="grid" onSubmit={handlePreview}>
            <div className="actions">
              <button
                type="button"
                className={mode === 'outbound' ? 'button' : 'button ghost'}
                onClick={() => {
                  setMode('outbound');
                  setProductPreview(null);
                  setItemPreview(null);
                }}
              >
                Registrar saida (OUTBOUND)
              </button>
              <button
                type="button"
                className={mode === 'inbound' ? 'button secondary' : 'button ghost'}
                onClick={() => {
                  setMode('inbound');
                  setProductPreview(null);
                  setItemPreview(null);
                }}
              >
                Registrar entrada (INBOUND)
              </button>
            </div>

            <div className="actions">
              <button
                type="button"
                className={target === 'product' ? 'button ghost active-pill' : 'button ghost'}
                onClick={() => {
                  setTarget('product');
                  setError(null);
                  setSuccess(null);
                  setItemPreview(null);
                }}
              >
                Operacao por produto
              </button>
              <button
                type="button"
                className={target === 'item' ? 'button ghost active-pill' : 'button ghost'}
                onClick={() => {
                  setTarget('item');
                  setError(null);
                  setSuccess(null);
                  setProductPreview(null);
                }}
              >
                Operacao por item
              </button>
            </div>

            {target === 'item' && user?.role !== 'ADMIN' ? (
              <div className="alert-block warn">
                <strong>Atencao:</strong> movimentacao direta de item nesta tela usa ajuste de estoque e exige perfil ADMIN.
              </div>
            ) : null}

            <div className="form-grid">
              {target === 'product' ? (
                <>
                  <div className="field">
                    <label htmlFor="operation-product">Produto</label>
                    <select
                      id="operation-product"
                      className="select"
                      value={productForm.productId}
                      onChange={(e) => setProductForm({ ...productForm, productId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({product.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="operation-product-qty">Quantidade de produtos</label>
                    <input
                      id="operation-product-qty"
                      className="input"
                      value={productForm.qty}
                      onChange={(e) => setProductForm({ ...productForm, qty: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label htmlFor="operation-item">Item</label>
                    <select
                      id="operation-item"
                      className="select"
                      value={itemForm.itemId}
                      onChange={(e) => setItemForm({ ...itemForm, itemId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {items.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} ({item.sku}) - estoque {formatDecimal(item.qtyOnHand)} {item.unit}
                          </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="operation-item-qty">Quantidade de itens</label>
                    <input
                      id="operation-item-qty"
                      className="input"
                      value={itemForm.qty}
                      onChange={(e) => setItemForm({ ...itemForm, qty: e.target.value })}
                    />
                  </div>
                  {selectedItemForForm ? (
                    <div className="field full">
                      <div className="small">
                        Estoque atual: {formatDecimal(selectedItemForForm.qtyOnHand)} {selectedItemForForm.unit}
                        {selectedItemForForm.minQty ? ` | minimo: ${formatDecimal(selectedItemForForm.minQty)} ${selectedItemForForm.unit}` : ''}
                      </div>
                    </div>
                  ) : null}
                </>
              )}

              <div className="field full">
                <label htmlFor="operation-note">
                  {target === 'item' ? 'Nota (obrigatoria para item)' : 'Nota (opcional)'}
                </label>
                <textarea
                  id="operation-note"
                  className="textarea"
                  value={target === 'product' ? productForm.note : itemForm.note}
                  onChange={(e) =>
                    target === 'product'
                      ? setProductForm({ ...productForm, note: e.target.value })
                      : setItemForm({ ...itemForm, note: e.target.value })
                  }
                />
              </div>

              {user?.role === 'ADMIN' ? (
                <div className="field full checkbox-row">
                  <input
                    id="operation-override"
                    type="checkbox"
                    checked={target === 'product' ? productForm.allowNegativeOverride : itemForm.allowNegativeOverride}
                    onChange={(e) =>
                      target === 'product'
                        ? setProductForm({ ...productForm, allowNegativeOverride: e.target.checked })
                        : setItemForm({ ...itemForm, allowNegativeOverride: e.target.checked })
                    }
                  />
                  <label htmlFor="operation-override">Permitir override de estoque negativo (somente ADMIN)</label>
                </div>
              ) : null}
            </div>

            <div className="actions">
              <button type="submit" className="button ghost" disabled={runningPreview}>
                {runningPreview ? 'Calculando...' : 'Gerar preview'}
              </button>
              <button type="button" className="button" disabled={!canConfirm} onClick={() => void handleExecute()}>
                {submitting ? 'Confirmando...' : 'Confirmar operacao'}
              </button>
            </div>
          </form>
        </section>

        <section className="grid two">
          <div className="panel">
            <h2>Preview da operacao</h2>
            {!productPreview && !itemPreview ? (
              <p className="small">Preencha o formulario e gere o preview.</p>
            ) : target === 'product' && productPreview ? (
              <div className="grid">
                <div className="grid three">
                  <div className="kpi-card">
                    <div className="small">Produto</div>
                    <div className="card-value" style={{ fontSize: '1rem' }}>
                      {productPreview.product.name}
                    </div>
                    <div className="small">{productPreview.product.sku}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Custo total</div>
                    <div className="card-value">{formatDecimal(productPreview.totalCost)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Custo unitario</div>
                    <div className="card-value">{formatDecimal(productPreview.unitCost)}</div>
                  </div>
                </div>

                {!productPreview.canExecute ? (
                  <div className="alert-block danger">
                    <h3>Bloqueios de estoque</h3>
                    <ul>
                      {productPreview.shortages.map((shortage) => (
                        <li key={shortage.itemId}>
                          {shortage.itemName}: precisa {formatDecimal(shortage.requiredQty)} / disponivel{' '}
                          {formatDecimal(shortage.availableQty)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {productMinWarnings.length > 0 ? (
                  <div className="alert-block warn">
                    <h3>Alerta de estoque minimo</h3>
                    <p className="small">
                      Esta operacao deixa itens com estoque igual ou abaixo do minimo configurado. Revise antes de confirmar.
                    </p>
                    <ul>
                      {productMinWarnings.map((warning) => (
                        <li key={warning.itemId}>
                          {warning.itemName} ({warning.itemSku}): apos a operacao fica em {formatDecimal(warning.nextQtyOnHand)}{' '}
                          {warning.itemUnit} (minimo {formatDecimal(warning.minQty)} {warning.itemUnit})
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qtd</th>
                        <th>Preco</th>
                        <th>Custo linha</th>
                        <th>Estoque atual</th>
                        <th>Estoque apos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {productPreview.lines.map((line) => {
                        const negative = isNegativeValue(line.nextQtyOnHand);
                        const atOrBelowMin = productMinWarningIds.has(line.itemId);
                        const rowClass = negative ? 'table-row-danger' : atOrBelowMin ? 'table-row-warn' : undefined;

                        return (
                          <tr key={line.itemId} className={rowClass}>
                            <td>
                              {line.itemName}
                              <div className="small">{line.itemSku}</div>
                            </td>
                            <td>
                              {formatDecimal(line.itemQty)} {line.itemUnit}
                            </td>
                            <td>{formatDecimal(line.itemUnitPriceSnapshot)}</td>
                            <td>{formatDecimal(line.lineCost)}</td>
                            <td>{formatDecimal(line.currentQtyOnHand)}</td>
                            <td>
                              {formatDecimal(line.nextQtyOnHand)}
                              {negative ? <div className="small" style={{ color: '#b91c1c' }}>Negativo (bloqueado)</div> : null}
                              {!negative && atOrBelowMin ? (
                                <div className="small" style={{ color: '#166534' }}>Abaixo/igual ao minimo</div>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : itemPreview ? (
              <div className="grid">
                <div className="grid three">
                  <div className="kpi-card">
                    <div className="small">Item</div>
                    <div className="card-value" style={{ fontSize: '1rem' }}>
                      {itemPreview.itemName}
                    </div>
                    <div className="small">{itemPreview.itemSku}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Delta</div>
                    <div className="card-value">{formatDecimal(itemPreview.deltaQty)}</div>
                    <div className="small">{itemPreview.itemUnit}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Custo estimado</div>
                    <div className="card-value">{formatDecimal(itemPreview.estimatedCost)}</div>
                    <div className="small">preco atual: {formatDecimal(itemPreview.unitPrice)}</div>
                  </div>
                </div>

                {itemPreview.requiresAdmin ? (
                  <div className="alert-block warn">
                    <strong>Permissao necessaria:</strong> somente ADMIN pode confirmar operacao direta por item.
                  </div>
                ) : null}

                {itemPreview.negativeBlocked ? (
                  <div className="alert-block danger">
                    <strong>Bloqueio de estoque:</strong> a operacao deixaria o item com estoque negativo e o override nao esta habilitado.
                  </div>
                ) : null}

                {itemPreview.minWarning ? (
                  <div className="alert-block warn">
                    <strong>Alerta de estoque minimo:</strong> apos a operacao o item ficara com{' '}
                    {formatDecimal(itemPreview.nextQtyOnHand)} {itemPreview.itemUnit}
                    {itemPreview.minQty ? (
                      <> (minimo configurado: {formatDecimal(itemPreview.minQty)} {itemPreview.itemUnit})</>
                    ) : null}
                    .
                  </div>
                ) : null}

                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Estoque atual</th>
                        <th>Delta</th>
                        <th>Estoque apos</th>
                        <th>Minimo</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className={itemPreview.negativeBlocked ? 'table-row-danger' : itemPreview.minWarning ? 'table-row-warn' : undefined}>
                        <td>
                          {itemPreview.itemName}
                          <div className="small">{itemPreview.itemSku}</div>
                        </td>
                        <td>
                          {formatDecimal(itemPreview.currentQtyOnHand)} {itemPreview.itemUnit}
                        </td>
                        <td>
                          {formatDecimal(itemPreview.deltaQty)} {itemPreview.itemUnit}
                        </td>
                        <td>
                          {formatDecimal(itemPreview.nextQtyOnHand)} {itemPreview.itemUnit}
                        </td>
                        <td>
                          {itemPreview.minQty ? `${formatDecimal(itemPreview.minQty)} ${itemPreview.itemUnit}` : '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="small">Sem preview disponivel.</p>
            )}
          </div>

          <div className="panel">
            <h2>Ordens / Operacoes recentes (produto)</h2>
            <p className="small">Movimentacoes diretas de item aparecem na tela de Movimentacoes (auditoria).</p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Produto</th>
                    <th>Qtd</th>
                    <th>Custo</th>
                    <th>Acao</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>Carregando...</td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhuma operacao registrada.</td>
                    </tr>
                  ) : (
                    orders.map((order) => (
                      <tr key={order.id}>
                        <td>{formatDateTime(order.createdAt)}</td>
                        <td>{order.type}</td>
                        <td>{order.product.name}</td>
                        <td>{formatDecimal(order.productQty)}</td>
                        <td>{formatDecimal(order.totalCost)}</td>
                        <td>
                          <button type="button" className="button ghost" onClick={() => void loadOrderDetail(order.id)}>
                            Detalhe
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {selectedOrder ? (
              <div className="grid" style={{ marginTop: '1rem' }}>
                <div className="separator" />
                <h3>Detalhe da ordem selecionada</h3>
                <p className="small">
                  {selectedOrder.type} | {selectedOrder.product.name} | {formatDateTime(selectedOrder.createdAt)} | por{' '}
                  {selectedOrder.createdByUser.email}
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
                            {line.item.name} <span className="small">({line.item.sku})</span>
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
              </div>
            ) : null}
          </div>
        </section>
      </AppShell>
    </RequireAuth>
  );
}

'use client';

import { FormEvent, useEffect, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal } from '@/lib/format';
import { operationFormSchema } from '@/lib/schemas';

type ProductOption = { id: string; name: string; sku: string; active: boolean };

type OperationPreviewResponse = {
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
  product: { id: string; name: string; sku: string; active: boolean };
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

export default function OperationsPage() {
  const { token, user } = useAuth();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [orders, setOrders] = useState<OrderListRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [mode, setMode] = useState<'outbound' | 'inbound'>('outbound');
  const [form, setForm] = useState({ productId: '', qty: '', note: '', allowNegativeOverride: false });
  const [preview, setPreview] = useState<OperationPreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningPreview, setRunningPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function loadProducts() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ProductOption[] }>('/products', { token });
    setProducts(response.data.filter((product) => product.active));
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
    Promise.all([loadProducts(), loadOrders()]).catch((caughtError) => {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar dados de operações');
    });
  }, [token]);

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setError(null);
    setSuccess(null);
    setRunningPreview(true);
    setPreview(null);

    try {
      const payload = operationFormSchema.parse(form);
      const endpoint = mode === 'outbound' ? '/operations/outbound/preview' : '/operations/inbound/preview';
      const response = await apiRequest<OperationPreviewResponse>(endpoint, {
        method: 'POST',
        token,
        body: payload,
      });
      setPreview(response);
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao gerar preview');
      }
    } finally {
      setRunningPreview(false);
    }
  }

  async function handleExecute() {
    if (!token || !preview) {
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = operationFormSchema.parse(form);
      const endpoint = mode === 'outbound' ? '/operations/outbound' : '/operations/inbound';
      const response = await apiRequest<{ data: OrderDetailRecord }>(endpoint, {
        method: 'POST',
        token,
        body: payload,
      });
      setSuccess('Operação registrada com sucesso.');
      setSelectedOrder(response.data);
      setPreview(null);
      await loadOrders();
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao registrar operação');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Operações</h1>
              <p className="page-subtitle">Registrar saída/entrada de produto com preview e custo calculado.</p>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {success ? <p className="inline-success">{success}</p> : null}
          <form className="grid" onSubmit={handlePreview}>
            <div className="actions">
              <button
                type="button"
                className={mode === 'outbound' ? 'button' : 'button ghost'}
                onClick={() => setMode('outbound')}
              >
                Registrar saída (OUTBOUND)
              </button>
              <button
                type="button"
                className={mode === 'inbound' ? 'button secondary' : 'button ghost'}
                onClick={() => setMode('inbound')}
              >
                Registrar entrada (INBOUND)
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <label htmlFor="operation-product">Produto</label>
                <select
                  id="operation-product"
                  className="select"
                  value={form.productId}
                  onChange={(e) => setForm({ ...form, productId: e.target.value })}
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
                  value={form.qty}
                  onChange={(e) => setForm({ ...form, qty: e.target.value })}
                />
              </div>
              <div className="field full">
                <label htmlFor="operation-note">Nota (opcional)</label>
                <textarea
                  id="operation-note"
                  className="textarea"
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                />
              </div>
              {user?.role === 'ADMIN' ? (
                <div className="field full checkbox-row">
                  <input
                    id="operation-override"
                    type="checkbox"
                    checked={form.allowNegativeOverride}
                    onChange={(e) => setForm({ ...form, allowNegativeOverride: e.target.checked })}
                  />
                  <label htmlFor="operation-override">Permitir override de estoque negativo (somente ADMIN)</label>
                </div>
              ) : null}
            </div>

            <div className="actions">
              <button type="submit" className="button ghost" disabled={runningPreview}>
                {runningPreview ? 'Calculando...' : 'Gerar preview'}
              </button>
              <button
                type="button"
                className="button"
                disabled={!preview || submitting || !preview.canExecute}
                onClick={() => void handleExecute()}
              >
                {submitting ? 'Confirmando...' : 'Confirmar operação'}
              </button>
            </div>
          </form>
        </section>

        <section className="grid two">
          <div className="panel">
            <h2>Preview da operação</h2>
            {!preview ? (
              <p className="small">Preencha o formulário e gere o preview.</p>
            ) : (
              <div className="grid">
                <div className="grid three">
                  <div className="kpi-card">
                    <div className="small">Produto</div>
                    <div className="card-value" style={{ fontSize: '1rem' }}>{preview.product.name}</div>
                    <div className="small">{preview.product.sku}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Custo total</div>
                    <div className="card-value">{formatDecimal(preview.totalCost)}</div>
                  </div>
                  <div className="kpi-card">
                    <div className="small">Custo unitário</div>
                    <div className="card-value">{formatDecimal(preview.unitCost)}</div>
                  </div>
                </div>

                {!preview.canExecute ? (
                  <div className="panel" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
                    <h3>Bloqueios de estoque</h3>
                    <ul>
                      {preview.shortages.map((shortage) => (
                        <li key={shortage.itemId}>
                          {shortage.itemName}: precisa {formatDecimal(shortage.requiredQty)} / disponível {formatDecimal(shortage.availableQty)}
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
                        <th>Preço</th>
                        <th>Custo linha</th>
                        <th>Estoque atual</th>
                        <th>Estoque após</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.lines.map((line) => (
                        <tr key={line.itemId}>
                          <td>
                            {line.itemName}
                            <div className="small">{line.itemSku}</div>
                          </td>
                          <td>{formatDecimal(line.itemQty)} {line.itemUnit}</td>
                          <td>{formatDecimal(line.itemUnitPriceSnapshot)}</td>
                          <td>{formatDecimal(line.lineCost)}</td>
                          <td>{formatDecimal(line.currentQtyOnHand)}</td>
                          <td>{formatDecimal(line.nextQtyOnHand)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <h2>Ordens / Operações recentes</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Produto</th>
                    <th>Qtd</th>
                    <th>Custo</th>
                    <th>Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>Carregando...</td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={6}>Nenhuma operação registrada.</td>
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
                  {selectedOrder.type} | {selectedOrder.product.name} | {formatDateTime(selectedOrder.createdAt)} | por {selectedOrder.createdByUser.email}
                </p>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Qtd</th>
                        <th>Preço snapshot</th>
                        <th>Custo linha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.lines.map((line) => (
                        <tr key={line.id}>
                          <td>{line.item.name} <span className="small">({line.item.sku})</span></td>
                          <td>{formatDecimal(line.itemQty)} {line.item.unit}</td>
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


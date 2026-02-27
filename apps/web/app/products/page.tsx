'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { DeleteActionDialog } from '@/components/delete-action-dialog';
import { MovementSummaryModal, type MovementSummaryRow } from '@/components/movement-summary-modal';
import { PanelModal } from '@/components/panel-modal';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDecimal } from '@/lib/format';
import { bomLineSchema, productFormSchema } from '@/lib/schemas';

type ProductRecord = {
  id: string;
  kind?: 'FINAL' | 'INTERMEDIATE';
  name: string;
  sku: string;
  manufacturingLeadTimeDays: string | null;
  qtyInStock: string;
  qtySoldTotal: string;
  productionCapacity?: string;
  productionCapacityLimiters?: Array<{
    itemId: string;
    itemName: string;
    itemSku: string;
    itemUnit: string;
    itemQtyOnHand: string;
    qtyRequiredPerProduct: string;
    maxProductsFromItem: string;
  }>;
  productionCapacityItems?: Array<{
    itemId: string;
    itemName: string;
    itemSku: string;
    itemUnit: string;
    itemQtyOnHand: string;
    qtyRequiredPerProduct: string;
    maxProductsFromItem: string;
  }>;
  productionCapacityNotes?: string[];
  bomItemsCount?: number;
  bomIntermediateProductsCount?: number;
  bomComponentsCount?: number;
  createdAt: string;
  updatedAt: string;
};

type ItemOption = { id: string; name: string; sku: string; unit: string };
type IntermediateProductOption = { id: string; name: string; sku: string };

type ProductDetailResponse = {
  data: ProductRecord;
  bom: Array<{
    id: string;
    itemId: string;
    qtyRequired: string;
    item: { id: string; name: string; sku: string; unit: string; unitPrice: string; qtyOnHand: string };
  }>;
  intermediateBom?: Array<{
    id: string;
    intermediateProductId: string;
    qtyRequired: string;
    intermediateProduct: { id: string; kind: 'INTERMEDIATE'; name: string; sku: string; bomItemsCount: number };
  }>;
};

type BomFormLine = { itemId: string; qtyRequired: string };
type IntermediateBomFormLine = { intermediateProductId: string; qtyRequired: string };

type ProductOperationSummaryRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productQty: string;
  createdAt: string;
  note: string | null;
};

type ParsedSourceNote = {
  sourceText: string | null;
};

function parseSourceAndNote(note: string | null): ParsedSourceNote {
  if (!note) {
    return { sourceText: null };
  }

  const parts = note
    .trim()
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.length > 0 ? parts : [note.trim()]) {
    if (/^Origem:\s*/i.test(part)) {
      const sourceText = part.replace(/^Origem:\s*/i, '').trim();
      if (sourceText) {
        return { sourceText };
      }
    }
  }

  return { sourceText: null };
}

function emptyProductForm() {
  return {
    name: '',
    sku: '',
    manufacturingLeadTimeDays: '',
    qtyInStock: '0',
    qtySoldTotal: '0',
  };
}

const intermediateBomLineSchema = z.object({
  intermediateProductId: z.string().min(1, 'Selecione um produto intermediario'),
  qtyRequired: z.string().regex(/^\d+(\.\d+)?$/, 'Quantidade invalida').refine((value) => Number(value) > 0, {
    message: 'Quantidade deve ser maior que zero',
  }),
});

export default function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [intermediateProducts, setIntermediateProducts] = useState<IntermediateProductOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [createForm, setCreateForm] = useState(emptyProductForm());
  const [editForm, setEditForm] = useState(emptyProductForm());
  const [bomLines, setBomLines] = useState<BomFormLine[]>([]);
  const [intermediateBomLines, setIntermediateBomLines] = useState<IntermediateBomFormLine[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ product: ProductRecord; qty: string } | null>(null);
  const [capacityDialogProduct, setCapacityDialogProduct] = useState<ProductRecord | null>(null);
  const [movementDialogProduct, setMovementDialogProduct] = useState<ProductRecord | null>(null);
  const [movementDialogRows, setMovementDialogRows] = useState<MovementSummaryRow[]>([]);
  const [movementDialogLoading, setMovementDialogLoading] = useState(false);
  const [movementDialogError, setMovementDialogError] = useState<string | null>(null);

  const bomItemOptions = useMemo(() => items, [items]);
  const intermediateBomOptions = useMemo(
    () => intermediateProducts.filter((product) => product.id !== selectedProductId),
    [intermediateProducts, selectedProductId],
  );

  async function loadProducts() {
    if (!token) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const response = await apiRequest<{ data: ProductRecord[] }>(`/products${query}`, { token });
      setProducts(response.data);
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar produtos');
    } finally {
      setLoading(false);
    }
  }

  async function loadItems() {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<{ data: ItemOption[] }>('/items', { token });
      setItems(response.data);
    } catch {
      // ignore here; page-level errors are handled elsewhere.
    }
  }

  async function loadIntermediateProducts() {
    if (!token) {
      return;
    }
    try {
      const response = await apiRequest<{ data: IntermediateProductOption[] }>('/intermediate-products', { token });
      setIntermediateProducts(response.data);
    } catch {
      // ignore here; page-level errors are handled elsewhere.
    }
  }

  async function loadDetail(id: string): Promise<boolean> {
    if (!token) {
      return false;
    }
    setError(null);
    try {
      const response = await apiRequest<ProductDetailResponse>(`/products/${id}`, { token });
      setSelectedProductId(id);
      setDetail(response);
      setEditForm({
        name: response.data.name,
        sku: response.data.sku,
        manufacturingLeadTimeDays: response.data.manufacturingLeadTimeDays ?? '',
        qtyInStock: response.data.qtyInStock ?? '0',
        qtySoldTotal: response.data.qtySoldTotal ?? '0',
      });
      setBomLines(response.bom.map((line) => ({ itemId: line.itemId, qtyRequired: line.qtyRequired })));
      setIntermediateBomLines(
        (response.intermediateBom ?? []).map((line) => ({
          intermediateProductId: line.intermediateProductId,
          qtyRequired: line.qtyRequired,
        })),
      );
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar produto');
      return false;
    }
  }

  useEffect(() => {
    void loadProducts();
    void loadItems();
    void loadIntermediateProducts();
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
      const payload = productFormSchema.parse(createForm);
      await apiRequest<{ data: ProductRecord }>('/products', {
        method: 'POST',
        token,
        body: {
          ...payload,
          manufacturingLeadTimeDays: payload.manufacturingLeadTimeDays || undefined,
        },
      });
      setCreateForm(emptyProductForm());
      setSuccess('Produto criado com sucesso.');
      setCreateDialogOpen(false);
      await loadProducts();
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao criar produto');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedProductId) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = productFormSchema.parse(editForm);
      await apiRequest<{ data: ProductRecord }>(`/products/${selectedProductId}`, {
        method: 'PUT',
        token,
        body: {
          ...payload,
          manufacturingLeadTimeDays:
            payload.manufacturingLeadTimeDays === '' ? null : payload.manufacturingLeadTimeDays,
        },
      });
      setSuccess('Produto atualizado com sucesso.');
      await loadProducts();
      await loadDetail(selectedProductId);
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'Dados inválidos');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao atualizar produto');
      }
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id: string) {
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ data: ProductRecord }>(`/products/${id}`, { method: 'DELETE', token });
      setSuccess('Produto removido.');
      if (selectedProductId === id) {
        setSelectedProductId(null);
        setDetail(null);
        setBomLines([]);
        setIntermediateBomLines([]);
      }
      await loadProducts();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao remover produto');
    }
  }

  async function removeProductQuantity(product: ProductRecord, qty: string) {
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await apiRequest('/operations/outbound', {
        method: 'POST',
        token,
        body: {
          productId: product.id,
          qty,
          note: 'Remoção rápida pela lista de produtos',
        },
      });

      setSuccess(`Saída registrada para o produto "${product.name}".`);
      await loadProducts();
      if (selectedProductId === product.id) {
        await loadDetail(product.id);
      }
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao remover quantidade');
    }
  }

  function openDeleteDialog(product: ProductRecord) {
    setDeleteDialog({ product, qty: '1' });
    setError(null);
    setSuccess(null);
  }

  function closeDeleteDialog() {
    if (saving) {
      return;
    }
    setDeleteDialog(null);
  }

  function closeCapacityDialog() {
    setCapacityDialogProduct(null);
  }

  async function openProductMovementsDialog(product: ProductRecord) {
    if (!token) {
      return;
    }

    setMovementDialogProduct(product);
    setMovementDialogRows([]);
    setMovementDialogError(null);
    setMovementDialogLoading(true);

    try {
      const response = await apiRequest<{ data: ProductOperationSummaryRecord[] }>(
        `/operations?productId=${encodeURIComponent(product.id)}`,
        { token },
      );

      const rows: MovementSummaryRow[] = response.data.map((operation) => {
        const parsed = parseSourceAndNote(operation.note);
        const deltaSign = operation.type === 'OUTBOUND_PRODUCT' ? '-' : '+';
        return {
          id: operation.id,
          date: new Date(operation.createdAt).toLocaleString('pt-BR'),
          reference: operation.id,
          originText: parsed.sourceText ?? 'Produto',
          originAsBadge: !parsed.sourceText,
          originBadgeTone: !parsed.sourceText ? 'ok' : undefined,
          delta: `${deltaSign}${formatDecimal(operation.productQty)} un`,
        };
      });

      setMovementDialogRows(rows);
    } catch (caughtError) {
      setMovementDialogError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar movimentacoes do produto');
    } finally {
      setMovementDialogLoading(false);
    }
  }

  function closeProductMovementsDialog() {
    setMovementDialogProduct(null);
    setMovementDialogRows([]);
    setMovementDialogError(null);
    setMovementDialogLoading(false);
  }

  async function handleDeleteDialogQuantity() {
    if (!deleteDialog) {
      return;
    }

    const qty = deleteDialog.qty.trim();
    if (!/^\d+(\.\d+)?$/.test(qty) || /^0(?:\.0+)?$/.test(qty)) {
      setError('Informe uma quantidade decimal maior que zero.');
      return;
    }

    setSaving(true);
    try {
      await removeProductQuantity(deleteDialog.product, qty);
      setDeleteDialog(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteDialogAll() {
    if (!deleteDialog) {
      return;
    }

    setSaving(true);
    try {
      await deleteProduct(deleteDialog.product.id);
      setDeleteDialog(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveBom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !selectedProductId) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const parsedLines = bomLines.map((line) => bomLineSchema.parse(line));
      const parsedIntermediateLines = intermediateBomLines.map((line) => intermediateBomLineSchema.parse(line));
      await apiRequest<ProductDetailResponse>(`/products/${selectedProductId}/bom`, {
        method: 'PUT',
        token,
        body: { items: parsedLines, intermediateProducts: parsedIntermediateLines },
      });
      setSuccess('BOM salva com sucesso.');
      await loadProducts();
      await loadDetail(selectedProductId);
    } catch (caughtError) {
      if (caughtError instanceof z.ZodError) {
        setError(caughtError.issues[0]?.message ?? 'BOM inválida');
      } else {
        setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao salvar BOM');
      }
    } finally {
      setSaving(false);
    }
  }

  function addBomLine() {
    setBomLines((current) => [...current, { itemId: '', qtyRequired: '1' }]);
  }

  function addIntermediateBomLine() {
    setIntermediateBomLines((current) => [...current, { intermediateProductId: '', qtyRequired: '1' }]);
  }

  async function openDetailDialog(id: string) {
    const loaded = await loadDetail(id);
    if (loaded) {
      setDetailDialogOpen(true);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Produtos finais</h1>
              <p className="page-subtitle">Cadastro de produtos e edição da receita/BOM.</p>
            </div>
            <div className="actions header-search-actions">
              <input
                className="input"
                placeholder="Buscar por nome ou SKU"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="button" className="button ghost" onClick={() => void loadProducts()} disabled={loading}>
                {loading ? 'Carregando...' : 'Buscar'}
              </button>
              <button type="button" className="button" onClick={() => setCreateDialogOpen(true)}>
                Criar produto
              </button>
            </div>
          </div>
          {error ? <p className="inline-error">{error}</p> : null}
          {success ? <p className="inline-success">{success}</p> : null}
          <div className="table-wrap catalog-table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>Em estoque</th>
                  <th>Capacidade de producao</th>
                  <th>Ja sairam</th>
                  <th>BOM</th>
                  <th>Movimentacoes</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8}>Nenhum produto cadastrado.</td>
                  </tr>
                ) : (
                  products.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.sku}</td>
                      <td>{formatDecimal(product.qtyInStock)}</td>
                      <td>
                        <div className="capacity-cell">
                          <span className="capacity-cell-value">{formatDecimal(product.productionCapacity ?? '0')} un</span>
                          <button
                            type="button"
                            className="capacity-cell-button"
                            onClick={() => setCapacityDialogProduct(product)}
                          >
                            Ver mais
                          </button>
                        </div>
                      </td>
                      <td>{formatDecimal(product.qtySoldTotal)}</td>
                      <td>
                        {product.bomComponentsCount ?? ((product.bomItemsCount ?? 0) + (product.bomIntermediateProductsCount ?? 0))}{' '}
                        componentes
                        <div className="small">
                          {product.bomItemsCount ?? 0} item(ns)
                          {` | ${product.bomIntermediateProductsCount ?? 0} interm.`}
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="button ghost compact"
                          onClick={() => void openProductMovementsDialog(product)}
                        >
                          Movimentacoes
                        </button>
                      </td>
                      <td>
                        <div className="actions">
                          <button type="button" className="button ghost" onClick={() => void openDetailDialog(product.id)}>
                            Editar / BOM
                          </button>
                          <button type="button" className="button danger" onClick={() => openDeleteDialog(product)}>
                            Deletar
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <PanelModal open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} wide>
          <div className="panel modal-panel-shell">
            <h2>Criar produto</h2>
            <form className="form-grid" onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="create-product-name">Nome</label>
                <input
                  id="create-product-name"
                  className="input"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-product-sku">SKU (opcional)</label>
                <input
                  id="create-product-sku"
                  className="input"
                  placeholder="Gerado automaticamente se vazio"
                  value={createForm.sku}
                  onChange={(e) => setCreateForm({ ...createForm, sku: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-product-qty-in-stock">Produtos em estoque (manual)</label>
                <input
                  id="create-product-qty-in-stock"
                  className="input"
                  value={createForm.qtyInStock}
                  onChange={(e) => setCreateForm({ ...createForm, qtyInStock: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-product-manufacturing-lead-time">
                  Tempo medio de confeccao/criacao (Solda + Testes) (opcional)
                </label>
                <input
                  id="create-product-manufacturing-lead-time"
                  className="input"
                  placeholder="Ex.: 2 Horas, 3 Dias, 1 semana"
                  value={createForm.manufacturingLeadTimeDays}
                  onChange={(e) => setCreateForm({ ...createForm, manufacturingLeadTimeDays: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-product-qty-sold-total">Produtos ja sairam (manual)</label>
                <input
                  id="create-product-qty-sold-total"
                  className="input"
                  value={createForm.qtySoldTotal}
                  onChange={(e) => setCreateForm({ ...createForm, qtySoldTotal: e.target.value })}
                />
              </div>
              <div className="actions full">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Salvando...' : 'Criar produto'}
                </button>
              </div>
            </form>
          </div>
        </PanelModal>

        <PanelModal open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} wide>
          <div className="panel modal-panel-shell">
            <h2>Editar produto / BOM</h2>
            {!selectedProductId || !detail ? (
              <p className="small">Selecione um produto para editar os dados e a BOM.</p>
            ) : (
              <div className="grid">
                <form className="form-grid" onSubmit={handleUpdate}>
                  <div className="field">
                    <label htmlFor="edit-product-name">Nome</label>
                    <input
                      id="edit-product-name"
                      className="input"
                      value={editForm.name}
                      onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-product-sku">SKU (opcional)</label>
                    <input
                      id="edit-product-sku"
                      className="input"
                      placeholder="Gera novo SKU automaticamente se vazio"
                      value={editForm.sku}
                      onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-product-qty-in-stock">Produtos em estoque (manual)</label>
                    <input
                      id="edit-product-qty-in-stock"
                      className="input"
                      value={editForm.qtyInStock}
                      onChange={(e) => setEditForm({ ...editForm, qtyInStock: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-product-manufacturing-lead-time">
                      Tempo medio de confeccao/criacao (Solda + Testes) (opcional)
                    </label>
                    <input
                      id="edit-product-manufacturing-lead-time"
                      className="input"
                      placeholder="Ex.: 2 Horas, 3 Dias, 1 semana"
                      value={editForm.manufacturingLeadTimeDays}
                      onChange={(e) => setEditForm({ ...editForm, manufacturingLeadTimeDays: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="edit-product-qty-sold-total">Produtos ja sairam (manual/auto)</label>
                    <input
                      id="edit-product-qty-sold-total"
                      className="input"
                      value={editForm.qtySoldTotal}
                      onChange={(e) => setEditForm({ ...editForm, qtySoldTotal: e.target.value })}
                    />
                  </div>
                  <div className="actions full">
                    <button type="submit" className="button secondary" disabled={saving}>
                      Salvar produto
                    </button>
                  </div>
                </form>

                <div className="separator" />

                <form className="grid" onSubmit={handleSaveBom}>
                  <div className="actions">
                    <h3 style={{ margin: 0, marginRight: 'auto' }}>BOM / Receita</h3>
                    <button type="button" className="button ghost" onClick={addBomLine}>
                      Adicionar item
                    </button>
                    <button type="button" className="button ghost" onClick={addIntermediateBomLine}>
                      Adicionar produto intermediario
                    </button>
                  </div>
                  {bomLines.length === 0 && intermediateBomLines.length === 0 ? (
                    <p className="small">BOM vazia. Adicione itens e/ou produtos intermediarios.</p>
                  ) : null}
                  {bomLines.length > 0 ? <h4 style={{ margin: 0 }}>Itens da BOM</h4> : null}
                  {bomLines.map((line, index) => (
                    <div key={`${line.itemId}-${index}`} className="form-grid panel">
                      <div className="field full">
                        <label>Item</label>
                        <select
                          className="select"
                          value={line.itemId}
                          onChange={(event) =>
                            setBomLines((current) =>
                              current.map((row, rowIndex) => (rowIndex === index ? { ...row, itemId: event.target.value } : row)),
                            )
                          }
                        >
                          <option value="">Selecione...</option>
                          {bomItemOptions.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} ({item.sku}) - {item.unit}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Qtd necessária por 1 unidade</label>
                        <input
                          className="input"
                          value={line.qtyRequired}
                          onChange={(event) =>
                            setBomLines((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, qtyRequired: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="field">
                        <label>Ações</label>
                        <button
                          type="button"
                          className="button danger"
                          onClick={() => setBomLines((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                        >
                          Remover linha
                        </button>
                      </div>
                    </div>
                  ))}
                  {intermediateBomLines.length > 0 ? <h4 style={{ margin: 0 }}>Produtos intermediarios da BOM</h4> : null}
                  {intermediateBomLines.map((line, index) => (
                    <div key={`${line.intermediateProductId}-${index}`} className="form-grid panel">
                      <div className="field full">
                        <label>Produto intermediario</label>
                        <select
                          className="select"
                          value={line.intermediateProductId}
                          onChange={(event) =>
                            setIntermediateBomLines((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, intermediateProductId: event.target.value } : row,
                              ),
                            )
                          }
                        >
                          <option value="">Selecione...</option>
                          {intermediateBomOptions.map((product) => (
                            <option key={product.id} value={product.id}>
                              {product.name} ({product.sku})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Qtd necessaria por 1 unidade</label>
                        <input
                          className="input"
                          value={line.qtyRequired}
                          onChange={(event) =>
                            setIntermediateBomLines((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, qtyRequired: event.target.value } : row,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="field">
                        <label>Acoes</label>
                        <button
                          type="button"
                          className="button danger"
                          onClick={() =>
                            setIntermediateBomLines((current) => current.filter((_, rowIndex) => rowIndex !== index))
                          }
                        >
                          Remover linha
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="actions">
                    <button type="submit" className="button" disabled={saving || !selectedProductId}>
                      {saving ? 'Salvando...' : 'Salvar BOM'}
                    </button>
                  </div>
                </form>

                {detail.bom.length > 0 || (detail.intermediateBom?.length ?? 0) > 0 ? (
                  <div>
                    <h3>BOM atual</h3>
                    {detail.bom.length > 0 ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>Qtd</th>
                            <th>Preço atual</th>
                            <th>Estoque</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.bom.map((line) => (
                            <tr key={line.id}>
                              <td>{line.item.name}</td>
                              <td>{line.item.sku}</td>
                              <td>{formatDecimal(line.qtyRequired)} {line.item.unit}</td>
                              <td>{formatDecimal(line.item.unitPrice)}</td>
                              <td>{formatDecimal(line.item.qtyOnHand)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    ) : null}
                    {(detail.intermediateBom?.length ?? 0) > 0 ? (
                      <div className="table-wrap" style={{ marginTop: '0.75rem' }}>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>Produto intermediario</th>
                              <th>SKU</th>
                              <th>Qtd</th>
                              <th>BOM interna</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(detail.intermediateBom ?? []).map((line) => (
                              <tr key={line.id}>
                                <td>{line.intermediateProduct.name}</td>
                                <td>{line.intermediateProduct.sku}</td>
                                <td>{formatDecimal(line.qtyRequired)} un</td>
                                <td>{line.intermediateProduct.bomItemsCount} item(ns)</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </PanelModal>

        <DeleteActionDialog
          open={deleteDialog != null}
          busy={saving}
          title="Deletar produto"
          entityName={deleteDialog ? `${deleteDialog.product.name} (${deleteDialog.product.sku})` : ''}
          quantityLabel="Quantidade de produtos para remover"
          quantityUnit="un"
          quantityValue={deleteDialog?.qty ?? ''}
          totalValueLabel="Componentes na BOM"
          totalValue={
            deleteDialog
              ? String(
                  deleteDialog.product.bomComponentsCount ??
                    ((deleteDialog.product.bomItemsCount ?? 0) + (deleteDialog.product.bomIntermediateProductsCount ?? 0)),
                )
              : null
          }
          totalValueUnit="componentes"
          allModeDescription="Deletar tudo exclui o cadastro e remove vínculos/ordens relacionados ao produto."
          onClose={closeDeleteDialog}
          onQuantityChange={(value) =>
            setDeleteDialog((current) => (current ? { ...current, qty: value } : current))
          }
          onConfirmQuantity={handleDeleteDialogQuantity}
          onConfirmDeleteAll={handleDeleteDialogAll}
        />
        <MovementSummaryModal
          open={movementDialogProduct != null}
          title="Movimentacoes do produto"
          subtitle={movementDialogProduct ? `${movementDialogProduct.name} (${movementDialogProduct.sku})` : null}
          loading={movementDialogLoading}
          error={movementDialogError}
          rows={movementDialogRows}
          emptyMessage="Nenhuma movimentacao de produto encontrada."
          onClose={closeProductMovementsDialog}
        />
        {capacityDialogProduct ? (
          <div className="modal-overlay" role="presentation" onClick={closeCapacityDialog}>
            <div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="capacity-dialog-title"
              style={{ width: 'min(820px, 100%)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="modal-header">
                <div>
                  <h3 id="capacity-dialog-title">Capacidade de producao</h3>
                  <p className="small" style={{ margin: 0 }}>
                    {capacityDialogProduct.name} ({capacityDialogProduct.sku})
                  </p>
                </div>
                <button type="button" className="button ghost" onClick={closeCapacityDialog}>
                  Fechar
                </button>
              </div>
              <div className="modal-body-scroll capacity-modal-body">
                <div className="panel capacity-modal-summary">
                  <div className="small">Capacidade calculada</div>
                  <div className="card-value" style={{ fontSize: '1.25rem' }}>
                    {formatDecimal(capacityDialogProduct.productionCapacity ?? '0')} un
                  </div>
                </div>

                {capacityDialogProduct.productionCapacityNotes && capacityDialogProduct.productionCapacityNotes.length > 0 ? (
                  <div className="alert-block warn">
                    {capacityDialogProduct.productionCapacityNotes.map((note, index) => (
                      <div key={`${note}-${index}`}>{note}</div>
                    ))}
                  </div>
                ) : null}

                <div>
                  <h3 className="capacity-modal-section-title">Itens ordenados por limitacao (mais limitante primeiro)</h3>
                  {((capacityDialogProduct.productionCapacityItems && capacityDialogProduct.productionCapacityItems.length > 0)
                    ? capacityDialogProduct.productionCapacityItems
                    : capacityDialogProduct.productionCapacityLimiters) &&
                  (((capacityDialogProduct.productionCapacityItems && capacityDialogProduct.productionCapacityItems.length > 0)
                    ? capacityDialogProduct.productionCapacityItems
                    : capacityDialogProduct.productionCapacityLimiters)?.length ?? 0) > 0 ? (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Item</th>
                            <th>SKU</th>
                            <th>Estoque atual</th>
                            <th>Necessario por produto</th>
                            <th>Produz ate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            (capacityDialogProduct.productionCapacityItems && capacityDialogProduct.productionCapacityItems.length > 0)
                              ? capacityDialogProduct.productionCapacityItems
                              : capacityDialogProduct.productionCapacityLimiters ?? []
                          ).map((limiter) => (
                            <tr key={`${limiter.itemId}-${limiter.maxProductsFromItem}`}>
                              <td>{limiter.itemName}</td>
                              <td>{limiter.itemSku}</td>
                              <td>
                                {formatDecimal(limiter.itemQtyOnHand)} {limiter.itemUnit}
                              </td>
                              <td>
                                {formatDecimal(limiter.qtyRequiredPerProduct)} {limiter.itemUnit}
                              </td>
                              <td>{formatDecimal(limiter.maxProductsFromItem)} un</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="small" style={{ margin: 0 }}>
                      Nenhum item limitante encontrado para este produto.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </AppShell>
    </RequireAuth>
  );
}


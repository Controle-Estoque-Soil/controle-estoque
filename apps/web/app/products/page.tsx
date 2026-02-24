'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { DeleteActionDialog } from '@/components/delete-action-dialog';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDecimal } from '@/lib/format';
import { bomLineSchema, productFormSchema } from '@/lib/schemas';

type ProductRecord = {
  id: string;
  name: string;
  sku: string;
  bomItemsCount?: number;
  createdAt: string;
  updatedAt: string;
};

type ItemOption = { id: string; name: string; sku: string; unit: string };

type ProductDetailResponse = {
  data: ProductRecord;
  bom: Array<{
    id: string;
    itemId: string;
    qtyRequired: string;
    item: { id: string; name: string; sku: string; unit: string; unitPrice: string; qtyOnHand: string };
  }>;
};

type BomFormLine = { itemId: string; qtyRequired: string };

function emptyProductForm() {
  return {
    name: '',
    sku: '',
  };
}

export default function ProductsPage() {
  const { token } = useAuth();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProductDetailResponse | null>(null);
  const [createForm, setCreateForm] = useState(emptyProductForm());
  const [editForm, setEditForm] = useState(emptyProductForm());
  const [bomLines, setBomLines] = useState<BomFormLine[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ product: ProductRecord; qty: string } | null>(null);

  const bomItemOptions = useMemo(() => items, [items]);

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

  async function loadDetail(id: string) {
    if (!token) {
      return;
    }
    setError(null);
    try {
      const response = await apiRequest<ProductDetailResponse>(`/products/${id}`, { token });
      setSelectedProductId(id);
      setDetail(response);
      setEditForm({
        name: response.data.name,
        sku: response.data.sku,
      });
      setBomLines(response.bom.map((line) => ({ itemId: line.itemId, qtyRequired: line.qtyRequired })));
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar produto');
    }
  }

  useEffect(() => {
    void loadProducts();
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
      const payload = productFormSchema.parse(createForm);
      await apiRequest<{ data: ProductRecord }>('/products', { method: 'POST', token, body: payload });
      setCreateForm(emptyProductForm());
      setSuccess('Produto criado com sucesso.');
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
        body: payload,
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
      await apiRequest<ProductDetailResponse>(`/products/${selectedProductId}/bom`, {
        method: 'PUT',
        token,
        body: { items: parsedLines },
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

  return (
    <RequireAuth>
      <AppShell>
        <section className="panel">
          <div className="page-header">
            <div>
              <h1 className="page-title">Produtos finais</h1>
              <p className="page-subtitle">Cadastro de produtos e edição da receita/BOM.</p>
            </div>
            <div className="actions">
              <input
                className="input"
                placeholder="Buscar por nome ou SKU"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="button" className="button ghost" onClick={() => void loadProducts()} disabled={loading}>
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
                  <th>Produto</th>
                  <th>SKU</th>
                  <th>BOM</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={4}>Nenhum produto cadastrado.</td>
                  </tr>
                ) : (
                  products.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.sku}</td>
                      <td>{product.bomItemsCount ?? 0} itens</td>
                      <td>
                        <div className="actions">
                          <button type="button" className="button ghost" onClick={() => void loadDetail(product.id)}>
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

        <section className="grid two">
          <div className="panel">
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
              <div className="actions full">
                <button type="submit" className="button" disabled={saving}>
                  {saving ? 'Salvando...' : 'Criar produto'}
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
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
                  </div>
                  {bomLines.length === 0 ? <p className="small">BOM vazia. Adicione itens e quantidades.</p> : null}
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
                  <div className="actions">
                    <button type="submit" className="button" disabled={saving || !selectedProductId}>
                      {saving ? 'Salvando...' : 'Salvar BOM'}
                    </button>
                  </div>
                </form>

                {detail.bom.length > 0 ? (
                  <div>
                    <h3>BOM atual</h3>
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
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <DeleteActionDialog
          open={deleteDialog != null}
          busy={saving}
          title="Deletar produto"
          entityName={deleteDialog ? `${deleteDialog.product.name} (${deleteDialog.product.sku})` : ''}
          quantityLabel="Quantidade de produtos para remover"
          quantityUnit="un"
          quantityValue={deleteDialog?.qty ?? ''}
          totalValueLabel="Itens na BOM"
          totalValue={deleteDialog ? String(deleteDialog.product.bomItemsCount ?? 0) : null}
          totalValueUnit="itens"
          allModeDescription="Deletar tudo tenta excluir o cadastro do produto. Se houver ordens/movimentacoes vinculadas, o sistema bloqueará a exclusão."
          onClose={closeDeleteDialog}
          onQuantityChange={(value) =>
            setDeleteDialog((current) => (current ? { ...current, qty: value } : current))
          }
          onConfirmQuantity={handleDeleteDialogQuantity}
          onConfirmDeleteAll={handleDeleteDialogAll}
        />
      </AppShell>
    </RequireAuth>
  );
}


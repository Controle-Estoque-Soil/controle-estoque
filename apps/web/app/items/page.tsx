'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { DeleteActionDialog } from '@/components/delete-action-dialog';
import { ItemPurchaseSourcesModal, type ItemPurchaseSourceModalRow } from '@/components/item-purchase-sources-modal';
import { MovementSummaryModal, type MovementSummaryRow } from '@/components/movement-summary-modal';
import { PanelModal } from '@/components/panel-modal';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal, formatMovementReason, formatUserDisplayName } from '@/lib/format';
import { itemFormSchema } from '@/lib/schemas';

type ItemRecord = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  purchaseLeadTimeDays: string | null;
  purchaseSources: Array<{
    id: string;
    source: string | null;
    price: string | null;
    sortOrder: number;
  }>;
  qtyOnHand: string;
  minQty: string | null;
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
    createdByUser: { id: string; name?: string | null; email: string; role: string };
  }>;
};

type ItemMovementListRecord = {
  id: string;
  deltaQty: string;
  referenceType: string;
  referenceId: string | null;
  note: string | null;
  isReversal: boolean;
  isUndone: boolean;
  createdAt: string;
};

type ParsedSourceNote = {
  sourceText: string | null;
  displayNote: string | null;
};

type PurchaseSourceFormRow = {
  source: string;
  price: string;
};

function parseSourceAndNote(note: string | null): ParsedSourceNote {
  if (!note) {
    return { sourceText: null, displayNote: null };
  }

  const raw = note.trim().replace(/^\[ITEM_DIRETO_[A-Z_]+\]\s*/i, '').trim();
  if (!raw) {
    return { sourceText: null, displayNote: null };
  }

  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);

  let sourceText: string | null = null;
  const noteParts: string[] = [];

  for (const part of (parts.length > 0 ? parts : [raw])) {
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
    sourceText,
    displayNote: noteParts.length > 0 ? noteParts.join(' | ') : null,
  };
}

function isDirectItemOnlyMovement(movement: ItemMovementListRecord): boolean {
  if (movement.referenceType === 'PRODUCT_ORDER') {
    return false;
  }

  if (movement.note?.startsWith('[PRODUTO_ESTOQUE]')) {
    return false;
  }

  if (movement.isReversal || movement.isUndone) {
    return false;
  }

  return true;
}

function itemMovementOriginDisplay(movement: ItemMovementListRecord): { text: string; asBadge: boolean; tone?: 'warn' } {
  const parsed = parseSourceAndNote(movement.note);
  if (parsed.sourceText) {
    return { text: parsed.sourceText, asBadge: false };
  }

  if (movement.note?.startsWith('[ITEM_DIRETO_')) {
    return { text: 'Item direto', asBadge: true, tone: 'warn' };
  }

  return { text: 'Ajuste manual', asBadge: true };
}

function emptyItemForm() {
  return {
    name: '',
    sku: '',
    unit: 'un',
    unitPrice: '0',
    purchaseLeadTimeDays: '',
    purchaseSources: [] as PurchaseSourceFormRow[],
    qtyOnHand: '0',
    minQty: '',
  };
}

function emptyPurchaseSourceRow(): PurchaseSourceFormRow {
  return { source: '', price: '' };
}

function sanitizePurchaseSources(rows: PurchaseSourceFormRow[]): PurchaseSourceFormRow[] {
  return rows
    .map((row) => ({
      source: row.source.trim(),
      price: row.price.trim(),
    }))
    .filter((row) => row.source || row.price);
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ item: ItemRecord; qty: string } | null>(null);
  const [movementDialogItem, setMovementDialogItem] = useState<ItemRecord | null>(null);
  const [movementDialogRows, setMovementDialogRows] = useState<MovementSummaryRow[]>([]);
  const [movementDialogLoading, setMovementDialogLoading] = useState(false);
  const [movementDialogError, setMovementDialogError] = useState<string | null>(null);
  const [purchaseSourcesDialogItem, setPurchaseSourcesDialogItem] = useState<ItemRecord | null>(null);

  const selectedItem = useMemo(() => items.find((item) => item.id === selectedItemId) ?? null, [items, selectedItemId]);
  const purchaseSourceDialogRows = useMemo<ItemPurchaseSourceModalRow[]>(
    () =>
      (purchaseSourcesDialogItem?.purchaseSources ?? []).map((source) => ({
        id: source.id,
        source: source.source,
        price: source.price ? formatDecimal(source.price) : null,
      })),
    [purchaseSourcesDialogItem],
  );

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

  async function loadDetail(id: string): Promise<boolean> {
    if (!token) {
      return false;
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
        purchaseLeadTimeDays: response.item.purchaseLeadTimeDays ?? '',
        purchaseSources:
          response.item.purchaseSources?.map((source) => ({
            source: source.source ?? '',
            price: source.price ?? '',
          })) ?? [],
        qtyOnHand: response.item.qtyOnHand,
        minQty: response.item.minQty ?? '',
      });
      return true;
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar detalhe do item');
      return false;
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
          name: parsed.name,
          sku: parsed.sku,
          unit: parsed.unit,
          unitPrice: parsed.unitPrice,
          purchaseLeadTimeDays: parsed.purchaseLeadTimeDays || undefined,
          purchaseSources: sanitizePurchaseSources(parsed.purchaseSources),
          qtyOnHand: parsed.qtyOnHand,
          minQty: parsed.minQty,
        },
      });
      setCreateForm(emptyItemForm());
      setSuccess('Item criado com sucesso.');
      setCreateDialogOpen(false);
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
          purchaseLeadTimeDays: parsed.purchaseLeadTimeDays === '' ? null : parsed.purchaseLeadTimeDays,
          purchaseSources: sanitizePurchaseSources(parsed.purchaseSources),
          qtyOnHand: parsed.qtyOnHand,
          minQty: parsed.minQty,
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

  async function deleteItem(id: string) {
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await apiRequest<{ data: ItemRecord }>(`/items/${id}`, { method: 'DELETE', token });
      setSuccess('Item removido.');
      if (selectedItemId === id) {
        setDetail(null);
        setSelectedItemId(null);
      }
      await loadItems();
    } catch (caughtError) {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao remover item');
    }
  }

  async function removeItemQuantity(item: ItemRecord, qty: string) {
    if (!token) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
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
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao remover quantidade');
    }
  }

  function openDeleteDialog(item: ItemRecord) {
    setDeleteDialog({ item, qty: '1' });
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
      await removeItemQuantity(deleteDialog.item, qty);
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
      await deleteItem(deleteDialog.item.id);
      setDeleteDialog(null);
    } finally {
      setSaving(false);
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

  async function openItemMovementsDialog(item: ItemRecord) {
    if (!token) {
      return;
    }

    setMovementDialogItem(item);
    setMovementDialogRows([]);
    setMovementDialogError(null);
    setMovementDialogLoading(true);

    try {
      const response = await apiRequest<{ data: ItemMovementListRecord[] }>(`/movements?itemId=${encodeURIComponent(item.id)}`, { token });
      const rows: MovementSummaryRow[] = response.data
        .filter(isDirectItemOnlyMovement)
        .map((movement) => {
          const origin = itemMovementOriginDisplay(movement);
          return {
            id: movement.id,
            date: formatDateTime(movement.createdAt),
            reference: movement.referenceId ?? movement.id,
            originText: origin.text,
            originAsBadge: origin.asBadge,
            originBadgeTone: origin.tone,
            delta: `${formatDecimal(movement.deltaQty)} ${item.unit}`,
          };
        });
      setMovementDialogRows(rows);
    } catch (caughtError) {
      setMovementDialogError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar movimentacoes do item');
    } finally {
      setMovementDialogLoading(false);
    }
  }

  function closeItemMovementsDialog() {
    setMovementDialogItem(null);
    setMovementDialogRows([]);
    setMovementDialogError(null);
    setMovementDialogLoading(false);
  }

  async function openDetailDialog(id: string) {
    const loaded = await loadDetail(id);
    if (loaded) {
      setDetailDialogOpen(true);
    }
  }

  function openPurchaseSourcesDialog(item: ItemRecord) {
    setPurchaseSourcesDialogItem(item);
  }

  function closePurchaseSourcesDialog() {
    setPurchaseSourcesDialogItem(null);
  }

  function addCreatePurchaseSourceRow() {
    setCreateForm((current) => ({
      ...current,
      purchaseSources: [...current.purchaseSources, emptyPurchaseSourceRow()],
    }));
  }

  function addEditPurchaseSourceRow() {
    setEditForm((current) => ({
      ...current,
      purchaseSources: [...current.purchaseSources, emptyPurchaseSourceRow()],
    }));
  }

  function updateCreatePurchaseSourceRow(index: number, patch: Partial<PurchaseSourceFormRow>) {
    setCreateForm((current) => ({
      ...current,
      purchaseSources: current.purchaseSources.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  }

  function updateEditPurchaseSourceRow(index: number, patch: Partial<PurchaseSourceFormRow>) {
    setEditForm((current) => ({
      ...current,
      purchaseSources: current.purchaseSources.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)),
    }));
  }

  function removeCreatePurchaseSourceRow(index: number) {
    setCreateForm((current) => ({
      ...current,
      purchaseSources: current.purchaseSources.filter((_, rowIndex) => rowIndex !== index),
    }));
  }

  function removeEditPurchaseSourceRow(index: number) {
    setEditForm((current) => ({
      ...current,
      purchaseSources: current.purchaseSources.filter((_, rowIndex) => rowIndex !== index),
    }));
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
            <div className="actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="button" onClick={() => setCreateDialogOpen(true)}>
                Criar item
              </button>
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
                  <th>Preço médio</th>
                  <th>Estoque</th>
                  <th>Tempo compra (dias)</th>
                  <th>Onde comprar</th>
                  <th>Mínimo</th>
                  <th>Movimentacoes</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={10}>Nenhum item cadastrado.</td>
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
                        <td>{item.purchaseLeadTimeDays ? formatDecimal(item.purchaseLeadTimeDays) : '-'}</td>
                        <td>
                          <button type="button" className="button ghost compact" onClick={() => openPurchaseSourcesDialog(item)}>
                            Ver mais
                          </button>
                        </td>
                        <td>{item.minQty ? formatDecimal(item.minQty) : '-'}</td>
                        <td>
                          <button type="button" className="button ghost compact" onClick={() => void openItemMovementsDialog(item)}>
                            Movimentacoes
                          </button>
                        </td>
                        <td>
                          <div className="actions">
                            {belowMin ? <span className="badge warn">Abaixo min.</span> : null}
                            <button type="button" className="button ghost" onClick={() => void openDetailDialog(item.id)}>
                              Detalhe
                            </button>
                            <button type="button" className="button danger" onClick={() => openDeleteDialog(item)}>
                              Deletar
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

        <PanelModal open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} wide>
          <div className="panel modal-panel-shell">
            <h2>Criar item</h2>
            <form className="form-grid" onSubmit={handleCreate}>
              <div className="field">
                <label htmlFor="create-item-name">Nome</label>
                <input id="create-item-name" className="input" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="create-item-sku">SKU (opcional)</label>
                <input
                  id="create-item-sku"
                  className="input"
                  placeholder="Gerado automaticamente se vazio"
                  value={createForm.sku}
                  onChange={(e) => setCreateForm({ ...createForm, sku: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-item-unit">Unidade</label>
                <input id="create-item-unit" className="input" value={createForm.unit} onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="create-item-unit-price">Preço unitário médio</label>
                <input id="create-item-unit-price" className="input" value={createForm.unitPrice} onChange={(e) => setCreateForm({ ...createForm, unitPrice: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="create-item-purchase-lead-time">Tempo medio para compra (dias) (opcional)</label>
                <input
                  id="create-item-purchase-lead-time"
                  className="input"
                  placeholder="Ex.: 7 ou 3.5"
                  value={createForm.purchaseLeadTimeDays}
                  onChange={(e) => setCreateForm({ ...createForm, purchaseLeadTimeDays: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor="create-item-qty-on-hand">Qtd inicial</label>
                <input id="create-item-qty-on-hand" className="input" value={createForm.qtyOnHand} onChange={(e) => setCreateForm({ ...createForm, qtyOnHand: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="create-item-min-qty">Estoque minimo</label>
                <input id="create-item-min-qty" className="input" value={createForm.minQty} onChange={(e) => setCreateForm({ ...createForm, minQty: e.target.value })} />
              </div>
              <div className="field full">
                <div className="list-field-header">
                  <label style={{ margin: 0 }}>Onde comprar (opcional)</label>
                  <button type="button" className="button ghost compact" onClick={addCreatePurchaseSourceRow}>
                    Adicionar local
                  </button>
                </div>
                {createForm.purchaseSources.length === 0 ? (
                  <p className="small">Nenhum local/link cadastrado. Opcional.</p>
                ) : (
                  <div className="purchase-source-list">
                    {createForm.purchaseSources.map((row, index) => (
                      <div key={`create-source-${index}`} className="purchase-source-row">
                        <input
                          className="input"
                          placeholder="Local ou link de compra (opcional)"
                          value={row.source}
                          onChange={(e) => updateCreatePurchaseSourceRow(index, { source: e.target.value })}
                        />
                        <input
                          className="input"
                          placeholder="Preco medio no local (opcional)"
                          value={row.price}
                          onChange={(e) => updateCreatePurchaseSourceRow(index, { price: e.target.value })}
                        />
                        <button type="button" className="button ghost compact" onClick={() => removeCreatePurchaseSourceRow(index)}>
                          Remover
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="actions full">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? 'Salvando...' : 'Criar item'}
                </button>
              </div>
            </form>
          </div>
        </PanelModal>

        <PanelModal open={detailDialogOpen} onClose={() => setDetailDialogOpen(false)} wide>
          <div className="panel modal-panel-shell">
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
                    <label>SKU (opcional)</label>
                    <input
                      className="input"
                      placeholder="Gera novo SKU automaticamente se vazio"
                      value={editForm.sku}
                      onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Unidade</label>
                    <input className="input" value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Preço unitário médio</label>
                    <input className="input" value={editForm.unitPrice} onChange={(e) => setEditForm({ ...editForm, unitPrice: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Tempo medio para compra (dias) (opcional)</label>
                    <input
                      className="input"
                      placeholder="Ex.: 7 ou 3.5"
                      value={editForm.purchaseLeadTimeDays}
                      onChange={(e) => setEditForm({ ...editForm, purchaseLeadTimeDays: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label>Qtd em estoque</label>
                    <input className="input" value={editForm.qtyOnHand} onChange={(e) => setEditForm({ ...editForm, qtyOnHand: e.target.value })} />
                  </div>
                  <div className="field">
                    <label>Estoque minimo</label>
                    <input className="input" value={editForm.minQty} onChange={(e) => setEditForm({ ...editForm, minQty: e.target.value })} />
                  </div>
                  <div className="field full">
                    <div className="list-field-header">
                      <label style={{ margin: 0 }}>Onde comprar (opcional)</label>
                      <button type="button" className="button ghost compact" onClick={addEditPurchaseSourceRow}>
                        Adicionar local
                      </button>
                    </div>
                    {editForm.purchaseSources.length === 0 ? (
                      <p className="small">Nenhum local/link cadastrado.</p>
                    ) : (
                      <div className="purchase-source-list">
                        {editForm.purchaseSources.map((row, index) => (
                          <div key={`edit-source-${index}`} className="purchase-source-row">
                            <input
                              className="input"
                              placeholder="Local ou link de compra (opcional)"
                              value={row.source}
                              onChange={(e) => updateEditPurchaseSourceRow(index, { source: e.target.value })}
                            />
                            <input
                              className="input"
                              placeholder="Preco medio no local (opcional)"
                              value={row.price}
                              onChange={(e) => updateEditPurchaseSourceRow(index, { price: e.target.value })}
                            />
                            <button type="button" className="button ghost compact" onClick={() => removeEditPurchaseSourceRow(index)}>
                              Remover
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="actions full">
                    <button className="button secondary" type="submit" disabled={saving}>
                      {saving ? 'Salvando...' : 'Salvar edição'}
                    </button>
                  </div>
                </form>

                <>
                  <div className="separator" />
                  <form className="grid" onSubmit={handleAdjustStock}>
                    <h3>Ajuste manual de estoque</h3>
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
                        {user?.role === 'ADMIN' ? (
                          <div className="field full checkbox-row">
                            <input
                              id="allow-negative-override"
                              type="checkbox"
                              checked={adjustForm.allowNegativeOverride}
                              onChange={(e) => setAdjustForm({ ...adjustForm, allowNegativeOverride: e.target.checked })}
                            />
                            <label htmlFor="allow-negative-override">Permitir estoque negativo (override)</label>
                          </div>
                        ) : null}
                      </div>
                      <div className="actions">
                        <button className="button danger" type="submit" disabled={saving}>
                          Registrar ajuste
                        </button>
                      </div>
                  </form>
                </>

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
                              <td>{formatMovementReason(movement.reason, movement.deltaQty)}</td>
                              <td>{movement.referenceType}{movement.referenceId ? ` / ${movement.referenceId}` : ''}</td>
                              <td>{formatUserDisplayName(movement.createdByUser)}</td>
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
        </PanelModal>

        <DeleteActionDialog
          open={deleteDialog != null}
          busy={saving}
          title="Deletar item"
          entityName={deleteDialog ? `${deleteDialog.item.name} (${deleteDialog.item.sku})` : ''}
          quantityLabel="Quantidade para remover"
          quantityUnit={deleteDialog?.item.unit}
          quantityValue={deleteDialog?.qty ?? ''}
          totalValueLabel="Estoque atual"
          totalValue={deleteDialog ? formatDecimal(deleteDialog.item.qtyOnHand) : null}
          totalValueUnit={deleteDialog?.item.unit}
          allModeDescription="Deletar tudo tenta excluir o cadastro do item. Se houver auditoria, BOM ou ordens vinculadas, o sistema bloqueará a exclusão."
          onClose={closeDeleteDialog}
          onQuantityChange={(value) =>
            setDeleteDialog((current) => (current ? { ...current, qty: value } : current))
          }
          onConfirmQuantity={handleDeleteDialogQuantity}
          onConfirmDeleteAll={handleDeleteDialogAll}
        />
        <MovementSummaryModal
          open={movementDialogItem != null}
          title="Movimentacoes do item"
          subtitle={
            movementDialogItem ? `${movementDialogItem.name} (${movementDialogItem.sku}) - somente movimentacoes diretas do item` : null
          }
          loading={movementDialogLoading}
          error={movementDialogError}
          rows={movementDialogRows}
          emptyMessage="Nenhuma movimentacao direta deste item encontrada."
          onClose={closeItemMovementsDialog}
        />
        <ItemPurchaseSourcesModal
          open={purchaseSourcesDialogItem != null}
          title="Onde comprar"
          subtitle={purchaseSourcesDialogItem ? `${purchaseSourcesDialogItem.name} (${purchaseSourcesDialogItem.sku})` : null}
          rows={purchaseSourceDialogRows}
          onClose={closePurchaseSourcesDialog}
        />
      </AppShell>
    </RequireAuth>
  );
}


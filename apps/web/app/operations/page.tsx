'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { AppShell, RequireAuth } from '@/components/app-shell';
import { useAuth } from '@/components/auth-provider';
import { ProductOrderDetailModal } from '@/components/product-order-detail-modal';
import { apiRequest, ApiError } from '@/lib/api';
import { formatDateTime, formatDecimal, formatOperationType } from '@/lib/format';
import { itemOperationFormSchema, operationFormSchema, productInboundSourceSchema } from '@/lib/schemas';

type ProductOption = { id: string; kind?: 'FINAL' | 'INTERMEDIATE'; name: string; sku: string };
type ItemPurchaseSourceOption = {
  id: string;
  source: string | null;
  price: string | null;
  sortOrder: number;
};

type ItemOption = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  unitPrice: string;
  purchaseLeadTimeDays: string | null;
  purchaseSources: ItemPurchaseSourceOption[];
  qtyOnHand: string;
  minQty: string | null;
};

type ProductOperationPreviewResponse = {
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  product: { id: string; kind?: 'FINAL' | 'INTERMEDIATE'; name: string; sku: string };
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
  negativeBlocked: boolean;
  minWarning: boolean;
};

type ProcurementGuideItem = {
  itemId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  requiredQty: string;
  availableQty: string;
  missingQty: string;
  purchaseLeadTimeDays: string | null;
  purchaseSources: ItemPurchaseSourceOption[];
};

type OrderListRecord = {
  id: string;
  type: 'INBOUND_PRODUCT' | 'OUTBOUND_PRODUCT';
  productQty: string;
  totalCost: string;
  unitCost: string;
  createdAt: string;
  note: string | null;
  product: { id: string; kind?: 'FINAL' | 'INTERMEDIATE'; name: string; sku: string };
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
  product: { id: string; kind?: 'FINAL' | 'INTERMEDIATE'; name: string; sku: string };
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

function subtractNonNegative(requiredQty: string, availableQty: string): string {
  const required = toNumber(requiredQty) ?? 0;
  const available = toNumber(availableQty) ?? 0;
  return Math.max(required - available, 0).toString();
}

function slugifyForFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function OperationsPage() {
  const { token, user } = useAuth();
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [intermediateProducts, setIntermediateProducts] = useState<ProductOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [orders, setOrders] = useState<OrderListRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const [orderDetailError, setOrderDetailError] = useState<string | null>(null);
  const [mode, setMode] = useState<'outbound' | 'inbound'>('outbound');
  const [target, setTarget] = useState<'product' | 'intermediateProduct' | 'item'>('product');
  const [productForm, setProductForm] = useState({
    productId: '',
    qty: '',
    source: '',
    note: '',
    allowNegativeOverride: false,
  });
  const [itemForm, setItemForm] = useState({ itemId: '', qty: '', source: '', note: '', allowNegativeOverride: false });
  const [productPreview, setProductPreview] = useState<ProductOperationPreviewResponse | null>(null);
  const [itemPreview, setItemPreview] = useState<ItemOperationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningPreview, setRunningPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingProcurementPdf, setGeneratingProcurementPdf] = useState(false);

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

  const productProcurementGuideItems = useMemo<ProcurementGuideItem[]>(() => {
    if (!productPreview || productPreview.shortages.length === 0) {
      return [];
    }

    const lineByItemId = new Map(productPreview.lines.map((line) => [line.itemId, line]));

    return productPreview.shortages.map((shortage) => {
      const item = itemsById.get(shortage.itemId);
      const line = lineByItemId.get(shortage.itemId);

      return {
        itemId: shortage.itemId,
        itemName: shortage.itemName,
        itemSku: line?.itemSku ?? item?.sku ?? '-',
        itemUnit: line?.itemUnit ?? item?.unit ?? '',
        requiredQty: shortage.requiredQty,
        availableQty: shortage.availableQty,
        missingQty: subtractNonNegative(shortage.requiredQty, shortage.availableQty),
        purchaseLeadTimeDays: item?.purchaseLeadTimeDays ?? null,
        purchaseSources: item?.purchaseSources ?? [],
      };
    });
  }, [itemsById, productPreview]);

  const itemProcurementGuideItems = useMemo<ProcurementGuideItem[]>(() => {
    if (!itemPreview?.negativeBlocked) {
      return [];
    }

    const item = itemsById.get(itemPreview.itemId);

    return [
      {
        itemId: itemPreview.itemId,
        itemName: itemPreview.itemName,
        itemSku: itemPreview.itemSku,
        itemUnit: itemPreview.itemUnit,
        requiredQty: itemPreview.qty,
        availableQty: itemPreview.currentQtyOnHand,
        missingQty: subtractNonNegative(itemPreview.qty, itemPreview.currentQtyOnHand),
        purchaseLeadTimeDays: item?.purchaseLeadTimeDays ?? null,
        purchaseSources: item?.purchaseSources ?? [],
      },
    ];
  }, [itemPreview, itemsById]);

  async function loadProducts() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ProductOption[] }>('/products', { token });
    setProducts(response.data);
  }

  async function loadIntermediateProducts() {
    if (!token) {
      return;
    }
    const response = await apiRequest<{ data: ProductOption[] }>('/intermediate-products', { token });
    setIntermediateProducts(response.data);
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
    setOrderDetailLoading(true);
    setOrderDetailError(null);
    setSelectedOrder(null);
    try {
      const response = await apiRequest<{ data: OrderDetailRecord }>(`/operations/${orderId}`, { token });
      setSelectedOrder(response.data);
    } catch (caughtError) {
      setOrderDetailError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar detalhe da ordem');
    } finally {
      setOrderDetailLoading(false);
    }
  }

  useEffect(() => {
    if (!token) {
      return;
    }

    setError(null);
    Promise.all([loadProducts(), loadIntermediateProducts(), loadItems(), loadOrders()]).catch((caughtError) => {
      setError(caughtError instanceof ApiError ? caughtError.message : 'Falha ao carregar dados de operacoes');
    });
  }, [token]);

  function resetMessagesAndPreview() {
    setError(null);
    setSuccess(null);
    setProductPreview(null);
    setItemPreview(null);
  }

  function closeOrderDetailModal() {
    setSelectedOrder(null);
    setOrderDetailError(null);
    setOrderDetailLoading(false);
  }

  async function handleGenerateProcurementPdf() {
    const blockedItems = isProductLikeTarget ? productProcurementGuideItems : itemProcurementGuideItems;
    if (blockedItems.length === 0) {
      setError('Nao ha itens bloqueados para gerar PDF de compras');
      return;
    }

    setGeneratingProcurementPdf(true);
    setError(null);

    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      const operationTitle = isProductLikeTarget
        ? `${mode === 'outbound' ? 'Saida' : 'Entrada'} de ${target === 'intermediateProduct' ? 'produto intermediario' : 'produto'}`
        : `${mode === 'outbound' ? 'Saida' : 'Entrada'} de item`;

      const selectedProduct = isProductLikeTarget
        ? productOptionsForTarget.find((product) => product.id === productForm.productId) ?? null
        : null;

      const contextName = isProductLikeTarget
        ? selectedProduct?.name ?? productPreview?.product.name ?? 'Produto'
        : itemPreview?.itemName ?? selectedItemForForm?.name ?? 'Item';

      const contextSku = isProductLikeTarget
        ? selectedProduct?.sku ?? productPreview?.product.sku ?? ''
        : itemPreview?.itemSku ?? selectedItemForForm?.sku ?? '';

      const operationQty = isProductLikeTarget ? productForm.qty : itemForm.qty;
      const generatedAtText = formatDateTime(new Date().toISOString());

      const ensureSpace = (requiredHeight: number) => {
        if (y + requiredHeight <= pageHeight - margin) {
          return;
        }
        doc.addPage();
        y = margin;
      };

      const drawSimpleTable = (headers: [string, string], rows: Array<[string, string]>) => {
        const colWidths = [contentWidth * 0.72, contentWidth * 0.28];
        const paddingX = 6;
        const paddingY = 6;
        const headerFontSize = 9;
        const bodyFontSize = 9;
        const tableX = margin;

        ensureSpace(34);
        doc.setDrawColor(193, 216, 199);
        doc.setFillColor(245, 250, 246);

        const headerHeight = 24;
        doc.rect(tableX, y, colWidths[0], headerHeight, 'FD');
        doc.rect(tableX + colWidths[0], y, colWidths[1], headerHeight, 'FD');
        doc.setFontSize(headerFontSize);
        doc.setFont('helvetica', 'bold');
        doc.text(headers[0], tableX + paddingX, y + 15);
        doc.text(headers[1], tableX + colWidths[0] + paddingX, y + 15);
        y += headerHeight;

        doc.setFont('helvetica', 'normal');
        for (const row of rows) {
          const leftLines = doc.splitTextToSize(row[0] || '-', colWidths[0] - paddingX * 2) as string[];
          const rightLines = doc.splitTextToSize(row[1] || '-', colWidths[1] - paddingX * 2) as string[];
          const linesCount = Math.max(leftLines.length, rightLines.length, 1);
          const rowHeight = linesCount * (bodyFontSize + 2) + paddingY * 2;
          ensureSpace(rowHeight + 4);

          doc.rect(tableX, y, colWidths[0], rowHeight);
          doc.rect(tableX + colWidths[0], y, colWidths[1], rowHeight);
          doc.setFontSize(bodyFontSize);
          doc.text(leftLines, tableX + paddingX, y + paddingY + bodyFontSize);
          doc.text(rightLines, tableX + colWidths[0] + paddingX, y + paddingY + bodyFontSize);
          y += rowHeight;
        }
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Lista de compras para completar operacao', margin, y);
      y += 24;

      const generatedBoxHeight = 34;
      doc.setDrawColor(193, 216, 199);
      doc.setFillColor(245, 250, 246);
      doc.roundedRect(margin, y, contentWidth, generatedBoxHeight, 8, 8, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(22, 101, 52);
      doc.text('GERADO EM', margin + 10, y + 13);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      doc.text(generatedAtText, margin + 10, y + 27);
      y += generatedBoxHeight + 14;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(17, 24, 39);
      doc.text(`Tipo: ${operationTitle}`, margin, y);
      y += 14;
      doc.text(`Referencia: ${contextName}${contextSku ? ` (${contextSku})` : ''}`, margin, y);
      y += 14;
      doc.text(`Quantidade solicitada: ${formatDecimal(operationQty || '0')}`, margin, y);
      y += 14;
      y += 4;

      doc.setDrawColor(193, 216, 199);
      doc.line(margin, y, pageWidth - margin, y);
      y += 18;

      blockedItems.forEach((blockedItem, index) => {
        ensureSpace(140);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.text(`${blockedItem.itemName}${blockedItem.itemSku ? ` (${blockedItem.itemSku})` : ''}`, margin, y);
        y += 16;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        const leadTimeLabel = blockedItem.purchaseLeadTimeDays
          ? `${formatDecimal(blockedItem.purchaseLeadTimeDays)} dia(s)`
          : 'Nao informado';
        doc.text(
          `Necessario: ${formatDecimal(blockedItem.requiredQty)} ${blockedItem.itemUnit} | Disponivel: ${formatDecimal(
            blockedItem.availableQty,
          )} ${blockedItem.itemUnit} | Faltante: ${formatDecimal(blockedItem.missingQty)} ${blockedItem.itemUnit}`,
          margin,
          y,
        );
        y += 14;
        doc.text(`Tempo medio para compra: ${leadTimeLabel}`, margin, y);
        y += 12;

        const sourceRows: Array<[string, string]> =
          blockedItem.purchaseSources.length > 0
            ? blockedItem.purchaseSources.map((source) => [
                source.source?.trim() || 'Nao informado',
                source.price ? `${formatDecimal(source.price)}` : '-',
              ])
            : [['Sem local/link de compra cadastrado', '-']];

        drawSimpleTable(['Local / link', 'Preco medio'], sourceRows);

        if (index < blockedItems.length - 1) {
          y += 14;
          ensureSpace(12);
          doc.setDrawColor(226, 236, 229);
          doc.line(margin, y, pageWidth - margin, y);
          y += 14;
        }
      });

      const fileStamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePrefix = isProductLikeTarget ? 'lista-compras-operacao' : 'lista-compras-item';
      const fileName = `${filePrefix}-${slugifyForFileName(contextName) || 'preview'}-${fileStamp}.pdf`;
      doc.save(fileName);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? `Falha ao gerar PDF: ${caughtError.message}` : 'Falha ao gerar PDF');
    } finally {
      setGeneratingProcurementPdf(false);
    }
  }

  async function handleProductPreview() {
    if (!token) {
      return;
    }

    const payload = operationFormSchema.parse(productForm);
    if (mode === 'inbound') {
      productInboundSourceSchema.parse(productForm.source);
    }
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
    const negativeBlocked = nextQty < 0 && !payload.allowNegativeOverride;
    const canExecute = !negativeBlocked;
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
      if (isProductLikeTarget) {
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
    const sourceText = mode === 'inbound' ? productInboundSourceSchema.parse(productForm.source) : productForm.source.trim();
    const requestBody =
      mode === 'inbound' && sourceText
        ? {
            ...payload,
            note: [`Origem: ${sourceText}`, payload.note?.trim()].filter(Boolean).join(' | '),
          }
        : payload;
    const endpoint = mode === 'outbound' ? '/operations/outbound' : '/operations/inbound';
    const response = await apiRequest<{ data: OrderDetailRecord }>(endpoint, {
      method: 'POST',
      token,
      body: requestBody,
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
    const payload = itemOperationFormSchema.parse(itemForm);
    const sourceText = payload.source?.trim();
    const noteText = payload.note?.trim();
    const noteParts = mode === 'inbound' && sourceText ? [`Origem: ${sourceText}`, noteText] : [noteText];
    const noteDetails = noteParts.filter(Boolean).join(' | ');
    await apiRequest<{ data: ItemOption }>(`/items/${payload.itemId}/adjust-stock`, {
      method: 'POST',
      token,
      body: {
        deltaQty: buildSignedDelta(mode, payload.qty),
        note: noteDetails ? `[ITEM_DIRETO_${mode.toUpperCase()}] ${noteDetails}` : `[ITEM_DIRETO_${mode.toUpperCase()}]`,
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
      if (isProductLikeTarget) {
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

  const isProductLikeTarget = target === 'product' || target === 'intermediateProduct';
  const selectedItemForForm = itemForm.itemId ? itemsById.get(itemForm.itemId) ?? null : null;
  const productOptionsForTarget = target === 'intermediateProduct' ? intermediateProducts : products;
  const productTargetLabel = target === 'intermediateProduct' ? 'Produto intermediario' : 'Produto';
  const canConfirm =
    isProductLikeTarget
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
            <div className="selector-stack">
              <div className="selector-group">
                <div className="selector-group-head">
                  <h3>Tipo da operacao</h3>
                  <span className="small">Define se entra ou sai estoque</span>
                </div>
                <div className="choice-grid two">
                  <button
                    type="button"
                    className={`choice-card ${mode === 'outbound' ? 'active danger-tone' : ''}`}
                    onClick={() => {
                      setMode('outbound');
                      setProductPreview(null);
                      setItemPreview(null);
                    }}
                  >
                    <span className="choice-card-badge">Saida</span>
                    <span className="choice-card-title">Registrar saida</span>
                    <span className="choice-card-meta">Debita estoque de itens (direto) ou via BOM de produto.</span>
                  </button>
                  <button
                    type="button"
                    className={`choice-card ${mode === 'inbound' ? 'active success-tone' : ''}`}
                    onClick={() => {
                      setMode('inbound');
                      setProductPreview(null);
                      setItemPreview(null);
                    }}
                  >
                    <span className="choice-card-badge">Entrada</span>
                    <span className="choice-card-title">Registrar entrada</span>
                    <span className="choice-card-meta">Credita estoque de itens (direto) ou via BOM de produto.</span>
                  </button>
                </div>
              </div>

              <div className="field">
                <div className="selector-group-head">
                  <label>Aplicar em</label>
                  <span className="small">Selecao obrigatoria</span>
                </div>
                <div className="segmented segmented-inline" role="tablist" aria-label="Aplicar em">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={target === 'product'}
                    className={`segmented-button ${target === 'product' ? 'active' : ''}`}
                    onClick={() => {
                      setTarget('product');
                      setError(null);
                      setSuccess(null);
                      setItemPreview(null);
                    }}
                  >
                    Produto
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={target === 'intermediateProduct'}
                    className={`segmented-button ${target === 'intermediateProduct' ? 'active' : ''}`}
                    onClick={() => {
                      setTarget('intermediateProduct');
                      setError(null);
                      setSuccess(null);
                      setItemPreview(null);
                    }}
                  >
                    Produto intermediario
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={target === 'item'}
                    className={`segmented-button ${target === 'item' ? 'active' : ''}`}
                    onClick={() => {
                      setTarget('item');
                      setError(null);
                      setSuccess(null);
                      setProductPreview(null);
                    }}
                  >
                    Item
                  </button>
                </div>
              </div>
            </div>

            <div className="form-grid">
              {isProductLikeTarget ? (
                <>
                  <div className="field">
                    <label htmlFor="operation-product">{productTargetLabel}</label>
                    <select
                      id="operation-product"
                      className="select"
                      value={productForm.productId}
                      onChange={(e) => setProductForm({ ...productForm, productId: e.target.value })}
                    >
                      <option value="">Selecione...</option>
                      {productOptionsForTarget.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name} ({product.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="operation-product-qty">
                      {target === 'intermediateProduct' ? 'Quantidade de produtos intermediarios' : 'Quantidade de produtos'}
                    </label>
                    <input
                      id="operation-product-qty"
                      className="input"
                      value={productForm.qty}
                      onChange={(e) => setProductForm({ ...productForm, qty: e.target.value })}
                    />
                  </div>
                  {mode === 'inbound' ? (
                    <div className="field full">
                      <label htmlFor="operation-product-source">Origem (link, vendedor, revenda, etc)</label>
                      <input
                        id="operation-product-source"
                        className="input"
                        placeholder="Ex.: fornecedor X, revenda Y, https://loja.com/item..."
                        required
                        value={productForm.source}
                        onChange={(e) => setProductForm({ ...productForm, source: e.target.value })}
                      />
                    </div>
                  ) : null}
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
                  {mode === 'inbound' ? (
                    <div className="field full">
                      <label htmlFor="operation-item-source">Origem (link, vendedor, revenda, etc) (opcional)</label>
                      <input
                        id="operation-item-source"
                        className="input"
                        placeholder="Ex.: https://loja.com/produto, Mercado Livre, revenda X..."
                        value={itemForm.source}
                        onChange={(e) => setItemForm({ ...itemForm, source: e.target.value })}
                      />
                    </div>
                  ) : null}
                </>
              )}

              <div className="field full">
                <label htmlFor="operation-note">Nota (opcional)</label>
                <textarea
                  id="operation-note"
                  className="textarea"
                  value={isProductLikeTarget ? productForm.note : itemForm.note}
                  onChange={(e) =>
                    isProductLikeTarget
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
                    checked={isProductLikeTarget ? productForm.allowNegativeOverride : itemForm.allowNegativeOverride}
                    onChange={(e) =>
                      isProductLikeTarget
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
            ) : isProductLikeTarget && productPreview ? (
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
                    <div className="actions" style={{ justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="button ghost"
                        disabled={generatingProcurementPdf}
                        onClick={() => void handleGenerateProcurementPdf()}
                      >
                        {generatingProcurementPdf ? 'Gerando PDF...' : 'Gerar PDF de compras'}
                      </button>
                    </div>
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

                {itemPreview.negativeBlocked ? (
                  <div className="alert-block danger">
                    <strong>Bloqueio de estoque:</strong> a operacao deixaria o item com estoque negativo e o override nao esta habilitado.
                    <div className="actions" style={{ justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                      <button
                        type="button"
                        className="button ghost"
                        disabled={generatingProcurementPdf}
                        onClick={() => void handleGenerateProcurementPdf()}
                      >
                        {generatingProcurementPdf ? 'Gerando PDF...' : 'Gerar PDF de compras'}
                      </button>
                    </div>
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
                        <td>{formatOperationType(order.type)}</td>
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

          </div>
        </section>
        <ProductOrderDetailModal
          open={orderDetailLoading || Boolean(orderDetailError) || Boolean(selectedOrder)}
          title="Detalhe da ordem selecionada"
          loading={orderDetailLoading}
          error={orderDetailError}
          order={selectedOrder}
          onClose={closeOrderDetailModal}
        />
      </AppShell>
    </RequireAuth>
  );
}

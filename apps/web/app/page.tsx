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
  unitPrice: string;
  purchaseLeadTimeDays: string | null;
  qtyOnHand: string;
  minQty: string | null;
};

type ProductSummaryRecord = {
  id: string;
  kind?: 'FINAL' | 'INTERMEDIATE';
  name: string;
  sku: string;
  qtyInStock: string;
  qtySoldTotal: string;
  productionCapacity?: string;
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

function slugifyForFileName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function DashboardPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [belowMin, setBelowMin] = useState<ItemRecord[]>([]);
  const [products, setProducts] = useState<ProductSummaryRecord[]>([]);
  const [intermediateProducts, setIntermediateProducts] = useState<ProductSummaryRecord[]>([]);
  const [recentOperations, setRecentOperations] = useState<OrderListRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<OrderDetailRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatingSummaryPdf, setGeneratingSummaryPdf] = useState(false);

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
      apiRequest<{ data: ProductSummaryRecord[] }>('/products', { token, signal: controller.signal }),
      apiRequest<{ data: ProductSummaryRecord[] }>('/intermediate-products', { token, signal: controller.signal }),
      apiRequest<{ data: OrderListRecord[] }>('/operations', { token, signal: controller.signal }),
    ])
      .then(([itemsResponse, belowMinResponse, productsResponse, intermediateProductsResponse, operationsResponse]) => {
        setItems(itemsResponse.data);
        setBelowMin(belowMinResponse.data);
        setProducts(productsResponse.data);
        setIntermediateProducts(intermediateProductsResponse.data);
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

  async function handleGenerateDashboardSummaryPdf() {
    setGeneratingSummaryPdf(true);
    setError(null);

    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ unit: 'pt', format: 'a4' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 36;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;
      const generatedAt = formatDateTime(new Date().toISOString());

      const ensureSpace = (requiredHeight: number) => {
        if (y + requiredHeight <= pageHeight - margin) {
          return;
        }
        doc.addPage();
        y = margin;
      };

      const drawSectionTitle = (title: string) => {
        ensureSpace(28);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(17, 24, 39);
        doc.text(title, margin, y);
        y += 16;
      };

      const drawSimpleTable = (headers: string[], rows: string[][], columnRatios: number[]) => {
        const paddingX = 6;
        const paddingY = 6;
        const headerFontSize = 8;
        const bodyFontSize = 8;
        const totalRatio = columnRatios.reduce((sum, ratio) => sum + ratio, 0);
        const colWidths = columnRatios.map((ratio) => (contentWidth * ratio) / totalRatio);

        ensureSpace(34);
        doc.setDrawColor(193, 216, 199);
        doc.setFillColor(245, 250, 246);

        const headerHeight = 24;
        let x = margin;
        headers.forEach((header, index) => {
          doc.rect(x, y, colWidths[index] ?? 0, headerHeight, 'FD');
          x += colWidths[index] ?? 0;
        });

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(headerFontSize);
        x = margin;
        headers.forEach((header, index) => {
          doc.text(header, x + paddingX, y + 15);
          x += colWidths[index] ?? 0;
        });
        y += headerHeight;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(bodyFontSize);
        rows.forEach((row) => {
          const cellLines = row.map((cell, index) =>
            doc.splitTextToSize(String(cell || '-'), (colWidths[index] ?? 0) - paddingX * 2) as string[],
          );
          const linesCount = Math.max(...cellLines.map((lines) => lines.length), 1);
          const rowHeight = linesCount * (bodyFontSize + 2) + paddingY * 2;
          ensureSpace(rowHeight + 2);

          let rowX = margin;
          row.forEach((_, index) => {
            doc.rect(rowX, y, colWidths[index] ?? 0, rowHeight);
            rowX += colWidths[index] ?? 0;
          });

          rowX = margin;
          row.forEach((_, index) => {
            doc.text(cellLines[index] ?? ['-'], rowX + paddingX, y + paddingY + bodyFontSize);
            rowX += colWidths[index] ?? 0;
          });
          y += rowHeight;
        });
      };

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(17, 24, 39);
      doc.text('Resumo do dashboard - estoque', margin, y);
      y += 24;

      doc.setDrawColor(193, 216, 199);
      doc.setFillColor(245, 250, 246);
      doc.roundedRect(margin, y, contentWidth, 34, 8, 8, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(22, 101, 52);
      doc.text('GERADO EM', margin + 10, y + 13);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(17, 24, 39);
      doc.text(generatedAt, margin + 10, y + 27);
      y += 48;

      drawSectionTitle('Itens / Materia-prima');
      drawSimpleTable(
        ['Nome', 'SKU', 'Unidade', 'Preco medio', 'Estoque', 'Tempo compra', 'Minimo'],
        items.length > 0
          ? items.map((item) => [
              item.name,
              item.sku,
              item.unit,
              formatDecimal(item.unitPrice),
              formatDecimal(item.qtyOnHand),
              item.purchaseLeadTimeDays ? formatDecimal(item.purchaseLeadTimeDays) : '-',
              item.minQty ? formatDecimal(item.minQty) : '-',
            ])
          : [['Nenhum item cadastrado.', '', '', '', '', '', '']],
        [2.2, 1.8, 0.9, 1.1, 1.0, 1.2, 0.9],
      );
      y += 16;

      drawSectionTitle('Produtos intermediarios');
      drawSimpleTable(
        ['Nome', 'SKU', 'Estoque', 'Capacidade de producao atual', 'Ja sairam'],
        intermediateProducts.length > 0
          ? intermediateProducts.map((product) => [
              product.name,
              product.sku,
              formatDecimal(product.qtyInStock),
              formatDecimal(product.productionCapacity ?? '0'),
              formatDecimal(product.qtySoldTotal),
            ])
          : [['Nenhum produto intermediario cadastrado.', '', '', '', '']],
        [2.1, 1.8, 1.0, 2.1, 1.0],
      );
      y += 16;

      drawSectionTitle('Produtos finais');
      drawSimpleTable(
        ['Nome', 'SKU', 'Estoque', 'Capacidade de producao atual', 'Ja sairam'],
        products.length > 0
          ? products.map((product) => [
              product.name,
              product.sku,
              formatDecimal(product.qtyInStock),
              formatDecimal(product.productionCapacity ?? '0'),
              formatDecimal(product.qtySoldTotal),
            ])
          : [['Nenhum produto cadastrado.', '', '', '', '']],
        [2.1, 1.8, 1.0, 2.1, 1.0],
      );

      const fileStamp = new Date().toISOString().replace(/[:.]/g, '-');
      doc.save(`dashboard-resumo-${slugifyForFileName(generatedAt) || 'gerado'}-${fileStamp}.pdf`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? `Falha ao gerar PDF: ${caughtError.message}` : 'Falha ao gerar PDF');
    } finally {
      setGeneratingSummaryPdf(false);
    }
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
          <div className="page-header">
            <div>
              <h2>Resumo das tabelas</h2>
              <p className="small">Visao resumida de Itens, Produtos intermediarios e Produtos finais.</p>
            </div>
            <div className="actions">
              <button
                type="button"
                className="button ghost"
                onClick={() => void handleGenerateDashboardSummaryPdf()}
                disabled={generatingSummaryPdf}
              >
                {generatingSummaryPdf ? 'Gerando PDF...' : 'Gerar PDF resumo'}
              </button>
            </div>
          </div>

          <div className="grid" style={{ gap: '1rem' }}>
            <div>
              <h3>Itens / Materia-prima</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>SKU</th>
                      <th>Unidade</th>
                      <th>Preco medio</th>
                      <th>Estoque</th>
                      <th>Tempo compra</th>
                      <th>Minimo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={7}>Nenhum item cadastrado.</td>
                      </tr>
                    ) : (
                      items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.sku}</td>
                          <td>{item.unit}</td>
                          <td>{formatDecimal(item.unitPrice)}</td>
                          <td>{formatDecimal(item.qtyOnHand)}</td>
                          <td>{item.purchaseLeadTimeDays ? formatDecimal(item.purchaseLeadTimeDays) : '-'}</td>
                          <td>{item.minQty ? formatDecimal(item.minQty) : '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3>Produtos intermediarios</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>SKU</th>
                      <th>Estoque</th>
                      <th>Capacidade de producao atual</th>
                      <th>Ja sairam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intermediateProducts.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Nenhum produto intermediario cadastrado.</td>
                      </tr>
                    ) : (
                      intermediateProducts.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.sku}</td>
                          <td>{formatDecimal(product.qtyInStock)}</td>
                          <td>{formatDecimal(product.productionCapacity ?? '0')}</td>
                          <td>{formatDecimal(product.qtySoldTotal)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3>Produtos finais</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>SKU</th>
                      <th>Estoque</th>
                      <th>Capacidade de producao atual</th>
                      <th>Ja sairam</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.length === 0 ? (
                      <tr>
                        <td colSpan={5}>Nenhum produto cadastrado.</td>
                      </tr>
                    ) : (
                      products.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.sku}</td>
                          <td>{formatDecimal(product.qtyInStock)}</td>
                          <td>{formatDecimal(product.productionCapacity ?? '0')}</td>
                          <td>{formatDecimal(product.qtySoldTotal)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
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

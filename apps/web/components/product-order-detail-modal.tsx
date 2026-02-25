'use client';

import { formatDateTime, formatDecimal, formatOperationType, formatUserDisplayName } from '@/lib/format';

type ProductOrderDetail = {
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

type ProductOrderDetailModalProps = {
  open: boolean;
  title: string;
  loading?: boolean;
  error?: string | null;
  order: ProductOrderDetail | null;
  onClose: () => void;
};

export function ProductOrderDetailModal({
  open,
  title,
  loading = false,
  error = null,
  order,
  onClose,
}: ProductOrderDetailModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="product-order-detail-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 id="product-order-detail-title">{title}</h3>
            {order ? (
              <p className="small modal-subtitle">
                {formatOperationType(order.type)} | {order.product.name} ({order.product.sku}) | qtd {formatDecimal(order.productQty)} | custo
                total {formatDecimal(order.totalCost)} | {formatDateTime(order.createdAt)} | por {formatUserDisplayName(order.createdByUser)}
              </p>
            ) : null}
          </div>
          <button type="button" className="button ghost" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="modal-body-scroll">
          {loading ? <p className="small">Carregando itens da operacao...</p> : null}
          {error ? <p className="inline-error">{error}</p> : null}
          {order ? (
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
                  {order.lines.map((line) => (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}

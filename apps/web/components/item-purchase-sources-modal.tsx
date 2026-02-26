'use client';

export type ItemPurchaseSourceModalRow = {
  id: string;
  source: string | null;
  price: string | null;
};

type ItemPurchaseSourcesModalProps = {
  open: boolean;
  title?: string;
  subtitle?: string | null;
  rows: ItemPurchaseSourceModalRow[];
  onClose: () => void;
};

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function ItemPurchaseSourcesModal({
  open,
  title = 'Onde comprar',
  subtitle = null,
  rows,
  onClose,
}: ItemPurchaseSourcesModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-purchase-sources-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 id="item-purchase-sources-modal-title">{title}</h3>
            {subtitle ? <p className="small modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="button ghost" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="modal-body-scroll">
          {rows.length === 0 ? (
            <p className="small">Nenhum local/link de compra cadastrado para este item.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Local / link</th>
                    <th>Preco medio</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        {row.source ? (
                          looksLikeUrl(row.source) ? (
                            <a href={row.source} target="_blank" rel="noreferrer">
                              {row.source}
                            </a>
                          ) : (
                            row.source
                          )
                        ) : (
                          <span className="small">-</span>
                        )}
                      </td>
                      <td>{row.price ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

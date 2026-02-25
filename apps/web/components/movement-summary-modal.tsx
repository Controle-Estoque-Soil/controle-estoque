'use client';

export type MovementSummaryRow = {
  id: string;
  date: string;
  reference: string;
  originText: string;
  originBadgeTone?: 'ok' | 'warn';
  originAsBadge?: boolean;
  delta: string;
};

type MovementSummaryModalProps = {
  open: boolean;
  title: string;
  subtitle?: string | null;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  rows: MovementSummaryRow[];
  onClose: () => void;
};

export function MovementSummaryModal({
  open,
  title,
  subtitle = null,
  loading = false,
  error = null,
  emptyMessage = 'Nenhuma movimentacao encontrada.',
  rows,
  onClose,
}: MovementSummaryModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="movement-summary-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h3 id="movement-summary-modal-title">{title}</h3>
            {subtitle ? <p className="small modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="button ghost" onClick={onClose}>
            Fechar
          </button>
        </div>

        <div className="modal-body-scroll">
          {loading ? <p className="small">Carregando movimentacoes...</p> : null}
          {error ? <p className="inline-error">{error}</p> : null}

          {!loading && !error ? (
            rows.length === 0 ? (
              <p className="small">{emptyMessage}</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Referencia</th>
                      <th>Origem</th>
                      <th>Quantidade (delta)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.date}</td>
                        <td>{row.reference}</td>
                        <td>
                          {row.originAsBadge ? (
                            <span className={`badge ${row.originBadgeTone ?? ''}`.trim()}>{row.originText}</span>
                          ) : (
                            row.originText
                          )}
                        </td>
                        <td>{row.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}

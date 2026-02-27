'use client';

import { useEffect, useState } from 'react';

type DeleteMode = 'quantity' | 'all';

type DeleteActionDialogProps = {
  open: boolean;
  busy?: boolean;
  title: string;
  entityName: string;
  quantityLabel: string;
  quantityUnit?: string;
  quantityValue: string;
  totalValueLabel?: string;
  totalValue?: string | null;
  totalValueUnit?: string;
  allModeDescription?: string;
  onClose: () => void;
  onQuantityChange: (value: string) => void;
  onConfirmQuantity: () => void | Promise<void>;
  onConfirmDeleteAll: () => void | Promise<void>;
};

function normalizeDecimal(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  return value
    .toFixed(6)
    .replace(/\.?0+$/, '')
    .replace(',', '.');
}

export function DeleteActionDialog({
  open,
  busy = false,
  title,
  entityName,
  quantityLabel,
  quantityUnit,
  quantityValue,
  totalValueLabel,
  totalValue,
  totalValueUnit,
  allModeDescription,
  onClose,
  onQuantityChange,
  onConfirmQuantity,
  onConfirmDeleteAll,
}: DeleteActionDialogProps) {
  const [mode, setMode] = useState<DeleteMode>('quantity');

  useEffect(() => {
    if (open) {
      setMode('quantity');
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function adjustQuantity(step: number) {
    const current = Number.parseFloat(quantityValue.replace(',', '.'));
    const safeCurrent = Number.isFinite(current) ? current : 0;
    const next = Math.max(0, safeCurrent + step);
    onQuantityChange(next <= 0 ? '' : normalizeDecimal(next));
  }

  const showTotal = totalValue != null && totalValue !== '';

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 id="delete-dialog-title">{title}</h3>
            <p className="small" style={{ margin: 0 }}>
              {entityName}
            </p>
          </div>
          <button type="button" className="button ghost" onClick={onClose} disabled={busy}>
            Fechar
          </button>
        </div>

        <div className="modal-body-scroll">
          <div className="segmented" role="tablist" aria-label="Tipo de exclusao">
            <button
              type="button"
              className={mode === 'quantity' ? 'segmented-button active' : 'segmented-button'}
              onClick={() => setMode('quantity')}
              disabled={busy}
            >
              Quantidade
            </button>
            <button
              type="button"
              className={mode === 'all' ? 'segmented-button active' : 'segmented-button'}
              onClick={() => setMode('all')}
              disabled={busy}
            >
              Deletar tudo
            </button>
          </div>

          {mode === 'quantity' ? (
            <div className="grid">
              <div className="field">
                <label>{quantityLabel}</label>
                <div className="stepper">
                  <button type="button" className="button ghost" onClick={() => adjustQuantity(-1)} disabled={busy}>
                    -
                  </button>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={quantityValue}
                    onChange={(e) => onQuantityChange(e.target.value.replace(',', '.'))}
                    placeholder="1"
                    aria-label={quantityLabel}
                    disabled={busy}
                  />
                  <button type="button" className="button ghost" onClick={() => adjustQuantity(1)} disabled={busy}>
                    +
                  </button>
                </div>
                <p className="small" style={{ margin: 0 }}>
                  {quantityUnit ? `Unidade: ${quantityUnit}` : 'Informe a quantidade para remover.'}
                </p>
              </div>
              <div className="actions">
                <button type="button" className="button secondary" onClick={() => void onConfirmQuantity()} disabled={busy}>
                  {busy ? 'Processando...' : 'Confirmar quantidade'}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid">
              {showTotal ? (
                <div className="panel" style={{ padding: '0.75rem' }}>
                  <div className="small">{totalValueLabel ?? 'Total'}</div>
                  <div className="card-value" style={{ fontSize: '1.25rem' }}>
                    {totalValue} {totalValueUnit ?? ''}
                  </div>
                </div>
              ) : null}
              {allModeDescription ? <p className="small">{allModeDescription}</p> : null}
              <div className="actions">
                <button type="button" className="button danger" onClick={() => void onConfirmDeleteAll()} disabled={busy}>
                  {busy ? 'Processando...' : 'Deletar tudo'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

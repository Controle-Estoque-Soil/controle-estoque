'use client';

import type { ReactNode } from 'react';

type PanelModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  title?: string | null;
  subtitle?: string | null;
};

export function PanelModal({ open, onClose, children, wide = true, title = null, subtitle = null }: PanelModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <div
        className={`modal-card ${wide ? 'modal-card-wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'panel-modal-title' : undefined}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            {title ? <h3 id="panel-modal-title">{title}</h3> : null}
            {subtitle ? <p className="small modal-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="button ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
        <div className="modal-body-scroll">{children}</div>
      </div>
    </div>
  );
}

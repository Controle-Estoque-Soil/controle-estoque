import PDFDocument from 'pdfkit';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';

import type { AppConfig } from '../../config/env';

interface OutboundProductLine {
  itemName: string;
  itemSku: string;
  itemUnit: string;
  itemQty: string;
  itemUnitPriceSnapshot: string;
  lineCost: string;
}

export interface OutboundProductEmailPayload {
  referenceId: string;
  scopeLabel: 'Produto' | 'Produto intermediario';
  productName: string;
  productSku: string;
  productQty: string;
  totalCost: string;
  unitCost: string;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string;
  lines: OutboundProductLine[];
}

export interface OutboundItemEmailPayload {
  referenceId: string;
  itemName: string;
  itemSku: string;
  itemUnit: string;
  itemQty: string;
  itemUnitPrice: string;
  estimatedCost: string;
  previousQtyOnHand: string;
  nextQtyOnHand: string;
  note: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatPtBrDateTime(isoDate: string): string {
  const date = new Date(isoDate);
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

function userDisplayName(name: string | null, email: string): string {
  const trimmed = trimOrNull(name);
  return trimmed ?? email;
}

function formatDecimalValue(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  }).format(parsed);
}

function sanitizeFileToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

async function renderPdf(
  renderer: (doc: PDFKit.PDFDocument, addPageIfNeeded: (heightNeeded: number) => void) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: 40,
        right: 40,
        bottom: 40,
        left: 40,
      },
    });
    const chunks: Buffer[] = [];
    let y = 40;
    const lineGap = 5;

    const addPageIfNeeded = (heightNeeded: number) => {
      const bottomLimit = doc.page.height - 40;
      if (y + heightNeeded <= bottomLimit) {
        return;
      }
      doc.addPage();
      y = 40;
    };

    const originalText = doc.text.bind(doc);
    doc.text = ((text: string, x?: number, yInput?: number, options?: PDFKit.Mixins.TextOptions) => {
      if (typeof yInput === 'number') {
        y = yInput;
      }
      if (typeof x === 'number' && typeof yInput === 'number') {
        originalText(text, x, yInput, options);
      } else if (typeof x === 'number') {
        originalText(text, x, undefined, options);
      } else {
        originalText(text, options as PDFKit.Mixins.TextOptions | undefined);
      }
      y = doc.y + lineGap;
      return doc;
    }) as typeof doc.text;

    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      renderer(doc, addPageIfNeeded);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export class OutboundOperationEmailService {
  private transporter: nodemailer.Transporter | null = null;
  private transporterState: 'unknown' | 'ready' | 'unavailable' = 'unknown';
  private unavailableReasonLogged = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: FastifyBaseLogger,
  ) {}

  private logUnavailable(reason: string): void {
    if (this.unavailableReasonLogged) {
      return;
    }
    this.unavailableReasonLogged = true;
    this.logger.warn({ reason }, 'Outbound operation email disabled');
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.config.OUTBOUND_OPERATION_EMAIL_ENABLED) {
      this.transporterState = 'unavailable';
      return null;
    }

    if (this.transporterState === 'ready') {
      return this.transporter;
    }
    if (this.transporterState === 'unavailable') {
      return null;
    }

    const smtpHost = trimOrNull(this.config.SMTP_HOST) ?? 'smtp.gmail.com';
    const smtpUser = trimOrNull(this.config.SMTP_USER);
    const smtpPass = trimOrNull(this.config.SMTP_PASS);
    if (!smtpUser || !smtpPass) {
      this.transporterState = 'unavailable';
      this.logUnavailable('SMTP_USER and SMTP_PASS are required');
      return null;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });
    this.transporterState = 'ready';
    return this.transporter;
  }

  private getMailEnvelope() {
    const from = trimOrNull(this.config.SMTP_FROM) ?? trimOrNull(this.config.SMTP_USER);
    if (!from) {
      return null;
    }

    return {
      from,
      to: this.config.OUTBOUND_OPERATION_EMAIL_TO,
      subject: this.config.OUTBOUND_OPERATION_EMAIL_SUBJECT,
    };
  }

  private async buildProductOutboundPdf(payload: OutboundProductEmailPayload): Promise<Buffer> {
    const generatedAt = formatPtBrDateTime(payload.createdAt);
    const noteText = trimOrNull(payload.note) ?? '-';

    return renderPdf((doc, addPageIfNeeded) => {
      const margin = 40;
      const contentWidth = doc.page.width - margin * 2;

      doc.font('Helvetica-Bold').fontSize(18).text('Saida de operacao - Soil Tecnologia', margin);
      doc.moveDown(0.5);

      addPageIfNeeded(48);
      doc.roundedRect(margin, doc.y, contentWidth, 40, 6).fillAndStroke('#E9F8ED', '#B7DFC1');
      doc.fillColor('#166534').font('Helvetica-Bold').fontSize(9).text('GERADO EM', margin + 10, doc.y - 36);
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(generatedAt, margin + 10, doc.y - 22);
      doc.fillColor('#111827');
      doc.moveDown(1.5);

      doc.font('Helvetica').fontSize(11);
      doc.text(`Referencia: ${payload.referenceId}`);
      doc.text(`Escopo: ${payload.scopeLabel}`);
      doc.text(`Produto: ${payload.productName} (${payload.productSku})`);
      doc.text(`Quantidade: ${formatDecimalValue(payload.productQty)}`);
      doc.text(`Custo total: ${formatDecimalValue(payload.totalCost)}`);
      doc.text(`Custo unitario: ${formatDecimalValue(payload.unitCost)}`);
      doc.text(`Usuario: ${userDisplayName(payload.actorName, payload.actorEmail)} (${payload.actorEmail})`);
      doc.text(`Nota: ${noteText}`);
      doc.moveDown(1);

      doc.font('Helvetica-Bold').fontSize(13).text('Preview da operacao confirmada');
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(10);
      payload.lines.forEach((line, index) => {
        addPageIfNeeded(44);
        doc.text(
          `${index + 1}. ${line.itemName} (${line.itemSku}) | qtd ${formatDecimalValue(line.itemQty)} ${line.itemUnit} | preco ${formatDecimalValue(line.itemUnitPriceSnapshot)} | custo ${formatDecimalValue(line.lineCost)}`,
        );
      });
    });
  }

  private async buildItemOutboundPdf(payload: OutboundItemEmailPayload): Promise<Buffer> {
    const generatedAt = formatPtBrDateTime(payload.createdAt);
    const noteText = trimOrNull(payload.note) ?? '-';

    return renderPdf((doc, addPageIfNeeded) => {
      const margin = 40;
      const contentWidth = doc.page.width - margin * 2;

      doc.font('Helvetica-Bold').fontSize(18).text('Saida de operacao - Soil Tecnologia', margin);
      doc.moveDown(0.5);

      addPageIfNeeded(48);
      doc.roundedRect(margin, doc.y, contentWidth, 40, 6).fillAndStroke('#E9F8ED', '#B7DFC1');
      doc.fillColor('#166534').font('Helvetica-Bold').fontSize(9).text('GERADO EM', margin + 10, doc.y - 36);
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(generatedAt, margin + 10, doc.y - 22);
      doc.fillColor('#111827');
      doc.moveDown(1.5);

      doc.font('Helvetica').fontSize(11);
      doc.text(`Referencia: ${payload.referenceId}`);
      doc.text(`Escopo: Item`);
      doc.text(`Item: ${payload.itemName} (${payload.itemSku})`);
      doc.text(`Quantidade: ${formatDecimalValue(payload.itemQty)} ${payload.itemUnit}`);
      doc.text(`Preco unitario: ${formatDecimalValue(payload.itemUnitPrice)}`);
      doc.text(`Custo estimado: ${formatDecimalValue(payload.estimatedCost)}`);
      doc.text(`Estoque antes: ${formatDecimalValue(payload.previousQtyOnHand)} ${payload.itemUnit}`);
      doc.text(`Estoque depois: ${formatDecimalValue(payload.nextQtyOnHand)} ${payload.itemUnit}`);
      doc.text(`Usuario: ${userDisplayName(payload.actorName, payload.actorEmail)} (${payload.actorEmail})`);
      doc.text(`Nota: ${noteText}`);
    });
  }

  async sendProductOutbound(payload: OutboundProductEmailPayload): Promise<void> {
    const transporter = this.getTransporter();
    const envelope = this.getMailEnvelope();
    if (!transporter || !envelope) {
      return;
    }

    try {
      const pdf = await this.buildProductOutboundPdf(payload);
      const fileName = `saida-${sanitizeFileToken(payload.productName) || 'produto'}-${payload.referenceId}.pdf`;
      await transporter.sendMail({
        from: envelope.from,
        to: envelope.to,
        subject: envelope.subject,
        text: `Saida confirmada de ${payload.scopeLabel.toLowerCase()} ${payload.productName} (${payload.productQty}). Referencia: ${payload.referenceId}.`,
        attachments: [
          {
            filename: fileName,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (error) {
      this.logger.error({ err: error, referenceId: payload.referenceId }, 'Failed to send outbound product email');
    }
  }

  async sendItemOutbound(payload: OutboundItemEmailPayload): Promise<void> {
    const transporter = this.getTransporter();
    const envelope = this.getMailEnvelope();
    if (!transporter || !envelope) {
      return;
    }

    try {
      const pdf = await this.buildItemOutboundPdf(payload);
      const fileName = `saida-${sanitizeFileToken(payload.itemName) || 'item'}-${payload.referenceId}.pdf`;
      await transporter.sendMail({
        from: envelope.from,
        to: envelope.to,
        subject: envelope.subject,
        text: `Saida confirmada de item ${payload.itemName} (${payload.itemQty} ${payload.itemUnit}). Referencia: ${payload.referenceId}.`,
        attachments: [
          {
            filename: fileName,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });
    } catch (error) {
      this.logger.error({ err: error, referenceId: payload.referenceId }, 'Failed to send outbound item email');
    }
  }
}

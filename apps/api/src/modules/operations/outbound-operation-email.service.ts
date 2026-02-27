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
  renderer: (doc: PDFKit.PDFDocument, tools: PdfRenderTools) => void,
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
    let y = doc.page.margins.top;

    const tools: PdfRenderTools = {
      margin: doc.page.margins.left,
      contentWidth: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      pageTop: doc.page.margins.top,
      pageBottom: doc.page.height - doc.page.margins.bottom,
      getY: () => y,
      setY: (nextY: number) => {
        y = nextY;
        doc.y = y;
      },
      ensureSpace: (heightNeeded: number) => {
        if (y + heightNeeded <= doc.page.height - doc.page.margins.bottom) {
          return false;
        }
        doc.addPage();
        y = doc.page.margins.top;
        doc.y = y;
        return true;
      },
    };

    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      renderer(doc, tools);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

type PdfRenderTools = {
  margin: number;
  contentWidth: number;
  pageTop: number;
  pageBottom: number;
  getY: () => number;
  setY: (nextY: number) => void;
  ensureSpace: (heightNeeded: number) => boolean;
};

type PdfInfoRow = {
  label: string;
  value: string;
};

const pdfPalette = {
  primary: '#14532d',
  primarySoft: '#eaf7ee',
  primaryBorder: '#b7dfc1',
  text: '#111827',
  muted: '#4b5563',
  cardBackground: '#f8fbf9',
  cardBorder: '#d6e8dc',
  tableHeaderBackground: '#edf7f1',
  tableHeaderBorder: '#bfdcc9',
  tableRowBorder: '#dceae1',
  tableRowAlt: '#fbfdfc',
};

function drawPdfHeader(doc: PDFKit.PDFDocument, tools: PdfRenderTools, generatedAt: string): void {
  const headerHeight = 88;
  tools.ensureSpace(headerHeight + 8);
  const y = tools.getY();
  const titleX = tools.margin + 16;
  const titleWidth = tools.contentWidth - 250;
  const dateBoxWidth = 210;
  const dateX = tools.margin + tools.contentWidth - dateBoxWidth - 16;

  doc.roundedRect(tools.margin, y, tools.contentWidth, headerHeight, 10).fillAndStroke('#f1fbf4', pdfPalette.primaryBorder);

  doc.fillColor(pdfPalette.primary).font('Helvetica-Bold').fontSize(10).text('SOIL TECNOLOGIA', titleX, y + 12, { width: titleWidth });
  doc.fillColor(pdfPalette.text).font('Helvetica-Bold').fontSize(22).text('Saida de operacao', titleX, y + 28, { width: titleWidth });
  doc.fillColor(pdfPalette.muted).font('Helvetica').fontSize(10).text('Relatorio automatico de saida confirmada', titleX, y + 60, {
    width: titleWidth,
  });

  doc.roundedRect(dateX, y + 12, dateBoxWidth, 64, 8).fillAndStroke('#ffffff', '#cfe8d8');
  doc.fillColor(pdfPalette.primary).font('Helvetica-Bold').fontSize(9).text('GERADO EM', dateX + 12, y + 24, { width: dateBoxWidth - 24 });
  doc.fillColor(pdfPalette.text).font('Helvetica-Bold').fontSize(13).text(generatedAt, dateX + 12, y + 40, { width: dateBoxWidth - 24 });

  tools.setY(y + headerHeight + 14);
}

function drawInfoCard(doc: PDFKit.PDFDocument, tools: PdfRenderTools, title: string, rows: PdfInfoRow[]): void {
  const innerPadding = 12;
  const innerWidth = tools.contentWidth - innerPadding * 2;
  const rowMetrics = rows.map((row) => {
    doc.font('Helvetica-Bold').fontSize(9);
    const labelHeight = doc.heightOfString(row.label.toUpperCase(), { width: innerWidth });
    doc.font('Helvetica').fontSize(11);
    const valueHeight = doc.heightOfString(row.value, { width: innerWidth });
    return {
      row,
      labelHeight,
      valueHeight,
      totalHeight: labelHeight + valueHeight + 8,
    };
  });

  doc.font('Helvetica-Bold').fontSize(12);
  const titleHeight = doc.heightOfString(title, { width: innerWidth });
  const rowsHeight = rowMetrics.reduce((acc, metric) => acc + metric.totalHeight, 0);
  const separatorsHeight = Math.max(0, rowMetrics.length - 1) * 6;
  const cardHeight = innerPadding + titleHeight + 10 + rowsHeight + separatorsHeight + innerPadding;

  tools.ensureSpace(cardHeight + 8);
  const y = tools.getY();
  doc.roundedRect(tools.margin, y, tools.contentWidth, cardHeight, 8).fillAndStroke(pdfPalette.cardBackground, pdfPalette.cardBorder);

  let cursorY = y + innerPadding;
  doc.fillColor(pdfPalette.primary).font('Helvetica-Bold').fontSize(12).text(title, tools.margin + innerPadding, cursorY, {
    width: innerWidth,
  });
  cursorY += titleHeight + 10;

  rowMetrics.forEach((metric, index) => {
    doc.fillColor(pdfPalette.muted).font('Helvetica-Bold').fontSize(9).text(metric.row.label.toUpperCase(), tools.margin + innerPadding, cursorY, {
      width: innerWidth,
    });
    doc.fillColor(pdfPalette.text).font('Helvetica').fontSize(11).text(metric.row.value, tools.margin + innerPadding, cursorY + metric.labelHeight + 2, {
      width: innerWidth,
    });
    cursorY += metric.totalHeight;
    if (index < rowMetrics.length - 1) {
      doc
        .strokeColor('#e5efe8')
        .lineWidth(1)
        .moveTo(tools.margin + innerPadding, cursorY + 3)
        .lineTo(tools.margin + tools.contentWidth - innerPadding, cursorY + 3)
        .stroke();
      cursorY += 6;
    }
  });

  tools.setY(y + cardHeight + 12);
}

function drawSectionHeading(doc: PDFKit.PDFDocument, tools: PdfRenderTools, title: string): void {
  tools.ensureSpace(24);
  const y = tools.getY();
  doc.fillColor(pdfPalette.text).font('Helvetica-Bold').fontSize(13).text(title, tools.margin, y, { width: tools.contentWidth });
  tools.setY(doc.y + 6);
}

function drawProductLinesTable(doc: PDFKit.PDFDocument, tools: PdfRenderTools, lines: OutboundProductLine[]): void {
  const columns = [
    { key: 'item', label: 'Item', width: 0.33 },
    { key: 'sku', label: 'SKU', width: 0.19 },
    { key: 'qty', label: 'Qtd', width: 0.12 },
    { key: 'unitPrice', label: 'Preco', width: 0.18 },
    { key: 'lineCost', label: 'Custo', width: 0.18 },
  ] as const;
  const columnWidths = columns.map((column) => Math.floor(tools.contentWidth * column.width));
  const widthDiff = tools.contentWidth - columnWidths.reduce((acc, width) => acc + width, 0);
  columnWidths[columnWidths.length - 1] += widthDiff;

  const drawHeader = (isContinuation = false) => {
    if (isContinuation) {
      drawSectionHeading(doc, tools, 'Itens da operacao (contin.)');
    }
    tools.ensureSpace(28);
    const y = tools.getY();
    doc.rect(tools.margin, y, tools.contentWidth, 26).fillAndStroke(pdfPalette.tableHeaderBackground, pdfPalette.tableHeaderBorder);

    let cursorX = tools.margin;
    columns.forEach((column, index) => {
      const columnWidth = columnWidths[index];
      doc
        .fillColor(pdfPalette.primary)
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(column.label, cursorX + 8, y + 8, {
          width: columnWidth - 16,
          ellipsis: true,
        });
      cursorX += columnWidth;
    });
    tools.setY(y + 26);
  };

  drawSectionHeading(doc, tools, 'Itens da operacao');
  drawHeader();

  lines.forEach((line, index) => {
    const rowValues = [
      line.itemName,
      line.itemSku,
      `${formatDecimalValue(line.itemQty)} ${line.itemUnit}`,
      formatDecimalValue(line.itemUnitPriceSnapshot),
      formatDecimalValue(line.lineCost),
    ];
    const rowHeights = rowValues.map((value, columnIndex) => {
      doc.font('Helvetica').fontSize(10);
      return doc.heightOfString(value, {
        width: columnWidths[columnIndex] - 16,
      });
    });
    const rowHeight = Math.max(28, Math.max(...rowHeights) + 12);
    const pageChanged = tools.ensureSpace(rowHeight + 2);
    if (pageChanged) {
      drawHeader(true);
    }

    const y = tools.getY();
    const fillColor = index % 2 === 0 ? '#ffffff' : pdfPalette.tableRowAlt;
    doc.rect(tools.margin, y, tools.contentWidth, rowHeight).fillAndStroke(fillColor, pdfPalette.tableRowBorder);

    let cursorX = tools.margin;
    rowValues.forEach((value, columnIndex) => {
      doc
        .fillColor(pdfPalette.text)
        .font('Helvetica')
        .fontSize(10)
        .text(value, cursorX + 8, y + 6, {
          width: columnWidths[columnIndex] - 16,
          ellipsis: true,
        });
      cursorX += columnWidths[columnIndex];
    });

    tools.setY(y + rowHeight);
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

  private getDebugContext() {
    return {
      enabled: this.config.OUTBOUND_OPERATION_EMAIL_ENABLED,
      smtpHost: trimOrNull(this.config.SMTP_HOST) ?? 'smtp.gmail.com',
      smtpPort: this.config.SMTP_PORT,
      smtpSecure: this.config.SMTP_SECURE,
      smtpUserConfigured: Boolean(trimOrNull(this.config.SMTP_USER)),
      smtpPassConfigured: Boolean(trimOrNull(this.config.SMTP_PASS)),
      smtpFromConfigured: Boolean(trimOrNull(this.config.SMTP_FROM)),
      to: this.config.OUTBOUND_OPERATION_EMAIL_TO,
      subject: this.config.OUTBOUND_OPERATION_EMAIL_SUBJECT,
    };
  }

  private getTransporter(): nodemailer.Transporter | null {
    if (!this.config.OUTBOUND_OPERATION_EMAIL_ENABLED) {
      this.transporterState = 'unavailable';
      this.logUnavailable('OUTBOUND_OPERATION_EMAIL_ENABLED=false');
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
      this.logUnavailable('SMTP_FROM or SMTP_USER is required');
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

    return renderPdf((doc, tools) => {
      drawPdfHeader(doc, tools, generatedAt);

      drawInfoCard(doc, tools, 'Dados da operacao', [
        { label: 'Referencia', value: payload.referenceId },
        { label: 'Escopo', value: payload.scopeLabel },
        { label: 'Produto', value: `${payload.productName} (${payload.productSku})` },
        { label: 'Quantidade', value: formatDecimalValue(payload.productQty) },
        { label: 'Custo total', value: formatDecimalValue(payload.totalCost) },
        { label: 'Custo unitario', value: formatDecimalValue(payload.unitCost) },
        { label: 'Usuario', value: `${userDisplayName(payload.actorName, payload.actorEmail)} (${payload.actorEmail})` },
        { label: 'Nota', value: noteText },
      ]);

      drawProductLinesTable(doc, tools, payload.lines);
    });
  }

  private async buildItemOutboundPdf(payload: OutboundItemEmailPayload): Promise<Buffer> {
    const generatedAt = formatPtBrDateTime(payload.createdAt);
    const noteText = trimOrNull(payload.note) ?? '-';

    return renderPdf((doc, tools) => {
      drawPdfHeader(doc, tools, generatedAt);

      drawInfoCard(doc, tools, 'Dados da operacao', [
        { label: 'Referencia', value: payload.referenceId },
        { label: 'Escopo', value: 'Item' },
        { label: 'Item', value: `${payload.itemName} (${payload.itemSku})` },
        { label: 'Quantidade', value: `${formatDecimalValue(payload.itemQty)} ${payload.itemUnit}` },
        { label: 'Preco unitario', value: formatDecimalValue(payload.itemUnitPrice) },
        { label: 'Custo estimado', value: formatDecimalValue(payload.estimatedCost) },
        { label: 'Estoque antes', value: `${formatDecimalValue(payload.previousQtyOnHand)} ${payload.itemUnit}` },
        { label: 'Estoque depois', value: `${formatDecimalValue(payload.nextQtyOnHand)} ${payload.itemUnit}` },
        { label: 'Usuario', value: `${userDisplayName(payload.actorName, payload.actorEmail)} (${payload.actorEmail})` },
        { label: 'Nota', value: noteText },
      ]);
    });
  }

  async sendProductOutbound(payload: OutboundProductEmailPayload): Promise<void> {
    this.logger.info(
      {
        referenceId: payload.referenceId,
        scopeLabel: payload.scopeLabel,
        productName: payload.productName,
        productQty: payload.productQty,
        ...this.getDebugContext(),
      },
      'Outbound product email requested',
    );

    const transporter = this.getTransporter();
    const envelope = this.getMailEnvelope();
    if (!transporter || !envelope) {
      this.logger.warn(
        {
          referenceId: payload.referenceId,
          hasTransporter: Boolean(transporter),
          hasEnvelope: Boolean(envelope),
          ...this.getDebugContext(),
        },
        'Outbound product email skipped',
      );
      return;
    }

    try {
      const pdf = await this.buildProductOutboundPdf(payload);
      const fileName = `saida-${sanitizeFileToken(payload.productName) || 'produto'}-${payload.referenceId}.pdf`;
      const sendResult = await transporter.sendMail({
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
      this.logger.info(
        {
          referenceId: payload.referenceId,
          messageId: sendResult.messageId,
          accepted: sendResult.accepted,
          rejected: sendResult.rejected,
        },
        'Outbound product email sent',
      );
    } catch (error) {
      this.logger.error({ err: error, referenceId: payload.referenceId }, 'Failed to send outbound product email');
    }
  }

  async sendItemOutbound(payload: OutboundItemEmailPayload): Promise<void> {
    this.logger.info(
      {
        referenceId: payload.referenceId,
        itemName: payload.itemName,
        itemQty: payload.itemQty,
        itemUnit: payload.itemUnit,
        ...this.getDebugContext(),
      },
      'Outbound item email requested',
    );

    const transporter = this.getTransporter();
    const envelope = this.getMailEnvelope();
    if (!transporter || !envelope) {
      this.logger.warn(
        {
          referenceId: payload.referenceId,
          hasTransporter: Boolean(transporter),
          hasEnvelope: Boolean(envelope),
          ...this.getDebugContext(),
        },
        'Outbound item email skipped',
      );
      return;
    }

    try {
      const pdf = await this.buildItemOutboundPdf(payload);
      const fileName = `saida-${sanitizeFileToken(payload.itemName) || 'item'}-${payload.referenceId}.pdf`;
      const sendResult = await transporter.sendMail({
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
      this.logger.info(
        {
          referenceId: payload.referenceId,
          messageId: sendResult.messageId,
          accepted: sendResult.accepted,
          rejected: sendResult.rejected,
        },
        'Outbound item email sent',
      );
    } catch (error) {
      this.logger.error({ err: error, referenceId: payload.referenceId }, 'Failed to send outbound item email');
    }
  }
}

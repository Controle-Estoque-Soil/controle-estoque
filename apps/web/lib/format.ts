export function formatDecimal(value: string | null | undefined): string {
  if (value == null || value === '') {
    return '-';
  }

  const number = Number(value);
  if (Number.isNaN(number)) {
    return value;
  }

  return number.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('pt-BR');
}

export function formatMovementReason(
  reason: string,
  deltaQty?: string | null,
): 'Saida de produto' | 'Chegada de produto' | 'Saida de item' | 'Chegada de item' {
  if (reason === 'PRODUCT_OUTBOUND') {
    return 'Saida de produto';
  }

  if (reason === 'PRODUCT_INBOUND') {
    return 'Chegada de produto';
  }

  const delta = Number(deltaQty ?? '0');
  return Number.isFinite(delta) && delta < 0 ? 'Saida de item' : 'Chegada de item';
}

export function formatOperationType(type: string): string {
  if (type === 'OUTBOUND_PRODUCT') {
    return 'Saida de produto';
  }

  if (type === 'INBOUND_PRODUCT') {
    return 'Chegada de produto';
  }

  return type;
}

export function formatUserDisplayName(user: { name?: string | null; email: string } | null | undefined): string {
  if (!user) {
    return '-';
  }

  const name = user.name?.trim();
  return name || user.email;
}


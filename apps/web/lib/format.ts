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


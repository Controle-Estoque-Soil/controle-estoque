import { Prisma } from '@prisma/client';

export function toDecimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) {
    return value;
  }

  return new Prisma.Decimal(value);
}

export function decimalToString(value: Prisma.Decimal | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  return value.toFixed();
}

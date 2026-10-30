export const TAX_RATE = 0.09;

export interface Invoice {
  id: string;
  lines: { description: string; amount: number; taxable: boolean }[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function taxFor(invoice: Invoice): number {
  const taxable = invoice.lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0);
  return round2(taxable * TAX_RATE);
}

export function totalFor(invoice: Invoice): number {
  const net = invoice.lines.reduce((s, l) => s + l.amount, 0);
  return round2(net + taxFor(invoice));
}

export function grossUp(grossAmount: number): number {
  // Net price of a taxable line that costs `grossAmount` after tax.
  return round2(grossAmount / (1 + TAX_RATE));
}

export function describeTax(): string {
  return `Sales tax ${(TAX_RATE * 100).toFixed(2)}%`;
}

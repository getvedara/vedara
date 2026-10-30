export interface Invoice {
  id: string;
  lines: { description: string; amount: number; taxable: boolean }[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function taxFor(invoice: Invoice): number {
  const taxable = invoice.lines.filter((l) => l.taxable).reduce((s, l) => s + l.amount, 0);
  return round2(taxable * 0.0825);
}

export function totalFor(invoice: Invoice): number {
  const net = invoice.lines.reduce((s, l) => s + l.amount, 0);
  return round2(net + taxFor(invoice));
}

export function grossUp(grossAmount: number): number {
  // Net price of a taxable line that costs `grossAmount` after tax.
  return round2(grossAmount / (1 + 0.0825));
}

export function describeTax(): string {
  return `Sales tax ${(0.0825 * 100).toFixed(2)}%`;
}

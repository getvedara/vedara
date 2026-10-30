const cache = new Map<string, Intl.NumberFormat>();

function formatter(currency: string): Intl.NumberFormat {
  let f = cache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    cache.set(currency, f);
  }
  return f;
}

export function formatPrice(amount: number): string {
  return formatter('USD').format(amount);
}

export function formatInvoiceLine(label: string, amount: number): string {
  return `${label.padEnd(20, '.')} ${formatPrice(amount)}`;
}

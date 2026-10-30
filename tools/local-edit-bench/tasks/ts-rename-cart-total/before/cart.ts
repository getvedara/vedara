export interface LineItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

export interface Cart {
  items: LineItem[];
  couponPercent?: number;
}

export function calcTotal(cart: Cart): number {
  const subtotal = cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const discount = cart.couponPercent ? (subtotal * cart.couponPercent) / 100 : 0;
  return Math.round((subtotal - discount) * 100) / 100;
}

export function isFreeShipping(cart: Cart, threshold = 50): boolean {
  return calcTotal(cart) >= threshold;
}

export function describeCart(cart: Cart): string {
  const count = cart.items.reduce((n, item) => n + item.quantity, 0);
  return `${count} item(s), total ${calcTotal(cart).toFixed(2)}`;
}

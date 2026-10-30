export interface Request {
  params: Record<string, string>;
  body: Record<string, unknown>;
}

export interface Response {
  status: number;
  body: unknown;
}

export type Store = Map<string, Map<number, Record<string, unknown>>>;

function table(store: Store, name: string): Map<number, Record<string, unknown>> {
  let t = store.get(name);
  if (!t) {
    t = new Map();
    store.set(name, t);
  }
  return t;
}

// ----- account -----

export function handleListAccount(req: Request, store: Store): Response {
  const rows = [...table(store, 'account').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetAccount(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'account').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'account not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateAccount(req: Request, store: Store): Response {
  const rows = table(store, 'account');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateAccount(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'account');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'account not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteAccount(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'account');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'account not found' } };
  }
  return { status: 204, body: null };
}

// ----- address -----

export function handleListAddress(req: Request, store: Store): Response {
  const rows = [...table(store, 'address').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetAddress(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'address').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'address not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateAddress(req: Request, store: Store): Response {
  const rows = table(store, 'address');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateAddress(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'address');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'address not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteAddress(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'address');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'address not found' } };
  }
  return { status: 204, body: null };
}

// ----- invoice -----

export function handleListInvoice(req: Request, store: Store): Response {
  const rows = [...table(store, 'invoice').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetInvoice(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'invoice').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'invoice not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateInvoice(req: Request, store: Store): Response {
  const rows = table(store, 'invoice');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateInvoice(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'invoice');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 400, body: { error: 'invoice not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteInvoice(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'invoice');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'invoice not found' } };
  }
  return { status: 204, body: null };
}

// ----- payment -----

export function handleListPayment(req: Request, store: Store): Response {
  const rows = [...table(store, 'payment').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetPayment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'payment').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'payment not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreatePayment(req: Request, store: Store): Response {
  const rows = table(store, 'payment');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdatePayment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'payment');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'payment not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeletePayment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'payment');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'payment not found' } };
  }
  return { status: 204, body: null };
}

// ----- shipment -----

export function handleListShipment(req: Request, store: Store): Response {
  const rows = [...table(store, 'shipment').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetShipment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'shipment').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'shipment not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateShipment(req: Request, store: Store): Response {
  const rows = table(store, 'shipment');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateShipment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'shipment');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'shipment not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteShipment(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'shipment');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'shipment not found' } };
  }
  return { status: 204, body: null };
}

// ----- warehouse -----

export function handleListWarehouse(req: Request, store: Store): Response {
  const rows = [...table(store, 'warehouse').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetWarehouse(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'warehouse').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'warehouse not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateWarehouse(req: Request, store: Store): Response {
  const rows = table(store, 'warehouse');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateWarehouse(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'warehouse');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'warehouse not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteWarehouse(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'warehouse');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'warehouse not found' } };
  }
  return { status: 204, body: null };
}

// ----- product -----

export function handleListProduct(req: Request, store: Store): Response {
  const rows = [...table(store, 'product').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetProduct(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'product').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'product not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateProduct(req: Request, store: Store): Response {
  const rows = table(store, 'product');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateProduct(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'product');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'product not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteProduct(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'product');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'product not found' } };
  }
  return { status: 204, body: null };
}

// ----- supplier -----

export function handleListSupplier(req: Request, store: Store): Response {
  const rows = [...table(store, 'supplier').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetSupplier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'supplier').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'supplier not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateSupplier(req: Request, store: Store): Response {
  const rows = table(store, 'supplier');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateSupplier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'supplier');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'supplier not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteSupplier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'supplier');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'supplier not found' } };
  }
  return { status: 204, body: null };
}

// ----- customer -----

export function handleListCustomer(req: Request, store: Store): Response {
  const rows = [...table(store, 'customer').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetCustomer(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'customer').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'customer not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateCustomer(req: Request, store: Store): Response {
  const rows = table(store, 'customer');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateCustomer(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'customer');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'customer not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteCustomer(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'customer');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'customer not found' } };
  }
  return { status: 204, body: null };
}

// ----- order -----

export function handleListOrder(req: Request, store: Store): Response {
  const rows = [...table(store, 'order').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetOrder(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'order').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'order not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateOrder(req: Request, store: Store): Response {
  const rows = table(store, 'order');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateOrder(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'order');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'order not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteOrder(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'order');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'order not found' } };
  }
  return { status: 204, body: null };
}

// ----- refund -----

export function handleListRefund(req: Request, store: Store): Response {
  const rows = [...table(store, 'refund').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetRefund(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'refund').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'refund not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateRefund(req: Request, store: Store): Response {
  const rows = table(store, 'refund');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateRefund(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'refund');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'refund not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteRefund(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'refund');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'refund not found' } };
  }
  return { status: 204, body: null };
}

// ----- coupon -----

export function handleListCoupon(req: Request, store: Store): Response {
  const rows = [...table(store, 'coupon').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetCoupon(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'coupon').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'coupon not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateCoupon(req: Request, store: Store): Response {
  const rows = table(store, 'coupon');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateCoupon(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'coupon');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'coupon not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteCoupon(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'coupon');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'coupon not found' } };
  }
  return { status: 204, body: null };
}

// ----- review -----

export function handleListReview(req: Request, store: Store): Response {
  const rows = [...table(store, 'review').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetReview(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'review').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'review not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateReview(req: Request, store: Store): Response {
  const rows = table(store, 'review');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateReview(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'review');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'review not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteReview(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'review');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'review not found' } };
  }
  return { status: 204, body: null };
}

// ----- category -----

export function handleListCategory(req: Request, store: Store): Response {
  const rows = [...table(store, 'category').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetCategory(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'category').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'category not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateCategory(req: Request, store: Store): Response {
  const rows = table(store, 'category');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateCategory(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'category');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'category not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteCategory(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'category');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'category not found' } };
  }
  return { status: 204, body: null };
}

// ----- carrier -----

export function handleListCarrier(req: Request, store: Store): Response {
  const rows = [...table(store, 'carrier').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetCarrier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'carrier').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'carrier not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreateCarrier(req: Request, store: Store): Response {
  const rows = table(store, 'carrier');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdateCarrier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'carrier');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'carrier not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeleteCarrier(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'carrier');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'carrier not found' } };
  }
  return { status: 204, body: null };
}

// ----- pallet -----

export function handleListPallet(req: Request, store: Store): Response {
  const rows = [...table(store, 'pallet').values()];
  const limit = Number(req.params.limit ?? 50);
  return { status: 200, body: rows.slice(0, limit) };
}

export function handleGetPallet(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const existing = table(store, 'pallet').get(id);
  if (!existing) {
    return { status: 404, body: { error: 'pallet not found' } };
  }
  return { status: 200, body: existing };
}

export function handleCreatePallet(req: Request, store: Store): Response {
  const rows = table(store, 'pallet');
  const id = rows.size + 1;
  const record = { ...req.body, id };
  rows.set(id, record);
  return { status: 201, body: record };
}

export function handleUpdatePallet(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'pallet');
  const existing = rows.get(id);
  if (!existing) {
    return { status: 404, body: { error: 'pallet not found' } };
  }
  const record = { ...existing, ...req.body, id };
  rows.set(id, record);
  return { status: 200, body: record };
}

export function handleDeletePallet(req: Request, store: Store): Response {
  const id = Number(req.params.id);
  const rows = table(store, 'pallet');
  if (!rows.delete(id)) {
    return { status: 404, body: { error: 'pallet not found' } };
  }
  return { status: 204, body: null };
}

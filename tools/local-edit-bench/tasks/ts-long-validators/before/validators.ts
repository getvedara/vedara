export type Input = Record<string, unknown>;

/** Validates a account payload; returns a list of error messages. */
export function validateAccount(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('account.name is required');
  } else if (name.length > 64) {
    errors.push('account.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('account.code is required');
  } else if (code.length > 64) {
    errors.push('account.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('account.description is required');
  } else if (description.length > 64) {
    errors.push('account.description is too long');
  }
  return errors;
}

/** Validates a address payload; returns a list of error messages. */
export function validateAddress(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('address.name is required');
  } else if (name.length > 64) {
    errors.push('address.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('address.code is required');
  } else if (code.length > 64) {
    errors.push('address.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('address.description is required');
  } else if (description.length > 64) {
    errors.push('address.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('address.owner is required');
  } else if (owner.length > 64) {
    errors.push('address.owner is too long');
  }
  return errors;
}

/** Validates a invoice payload; returns a list of error messages. */
export function validateInvoice(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('invoice.name is required');
  } else if (name.length > 64) {
    errors.push('invoice.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('invoice.code is required');
  } else if (code.length > 64) {
    errors.push('invoice.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('invoice.description is required');
  } else if (description.length > 64) {
    errors.push('invoice.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('invoice.owner is required');
  } else if (owner.length > 64) {
    errors.push('invoice.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('invoice.status is required');
  } else if (status.length > 64) {
    errors.push('invoice.status is too long');
  }
  return errors;
}

/** Validates a payment payload; returns a list of error messages. */
export function validatePayment(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('payment.name is required');
  } else if (name.length > 64) {
    errors.push('payment.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('payment.code is required');
  } else if (code.length > 64) {
    errors.push('payment.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('payment.description is required');
  } else if (description.length > 64) {
    errors.push('payment.description is too long');
  }
  return errors;
}

/** Validates a shipment payload; returns a list of error messages. */
export function validateShipment(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('shipment.name is required');
  } else if (name.length > 64) {
    errors.push('shipment.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('shipment.code is required');
  } else if (code.length > 64) {
    errors.push('shipment.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('shipment.description is required');
  } else if (description.length > 64) {
    errors.push('shipment.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('shipment.owner is required');
  } else if (owner.length > 64) {
    errors.push('shipment.owner is too long');
  }
  return errors;
}

/** Validates a warehouse payload; returns a list of error messages. */
export function validateWarehouse(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('warehouse.name is required');
  } else if (name.length > 64) {
    errors.push('warehouse.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('warehouse.code is required');
  } else if (code.length > 64) {
    errors.push('warehouse.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('warehouse.description is required');
  } else if (description.length > 64) {
    errors.push('warehouse.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('warehouse.owner is required');
  } else if (owner.length > 64) {
    errors.push('warehouse.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('warehouse.status is required');
  } else if (status.length > 64) {
    errors.push('warehouse.status is too long');
  }
  return errors;
}

/** Validates a product payload; returns a list of error messages. */
export function validateProduct(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('product.name is required');
  } else if (name.length > 64) {
    errors.push('product.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('product.code is required');
  } else if (code.length > 64) {
    errors.push('product.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('product.description is required');
  } else if (description.length > 64) {
    errors.push('product.description is too long');
  }
  return errors;
}

/** Validates a supplier payload; returns a list of error messages. */
export function validateSupplier(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('supplier.name is required');
  } else if (name.length > 64) {
    errors.push('supplier.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('supplier.code is required');
  } else if (code.length > 64) {
    errors.push('supplier.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('supplier.description is required');
  } else if (description.length > 64) {
    errors.push('supplier.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('supplier.owner is required');
  } else if (owner.length > 64) {
    errors.push('supplier.owner is too long');
  }
  return errors;
}

/** Validates a customer payload; returns a list of error messages. */
export function validateCustomer(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('customer.name is required');
  } else if (name.length > 64) {
    errors.push('customer.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('customer.code is required');
  } else if (code.length > 64) {
    errors.push('customer.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('customer.description is required');
  } else if (description.length > 64) {
    errors.push('customer.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('customer.owner is required');
  } else if (owner.length > 64) {
    errors.push('customer.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('customer.status is required');
  } else if (status.length > 64) {
    errors.push('customer.status is too long');
  }
  return errors;
}

/** Validates a order payload; returns a list of error messages. */
export function validateOrder(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('order.name is required');
  } else if (name.length > 64) {
    errors.push('order.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('order.code is required');
  } else if (code.length > 64) {
    errors.push('order.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('order.description is required');
  } else if (description.length > 64) {
    errors.push('order.description is too long');
  }
  return errors;
}

/** Validates a refund payload; returns a list of error messages. */
export function validateRefund(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('refund.name is required');
  } else if (name.length > 64) {
    errors.push('refund.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('refund.code is required');
  } else if (code.length > 64) {
    errors.push('refund.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('refund.description is required');
  } else if (description.length > 64) {
    errors.push('refund.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('refund.owner is required');
  } else if (owner.length > 64) {
    errors.push('refund.owner is too long');
  }
  return errors;
}

/** Validates a coupon payload; returns a list of error messages. */
export function validateCoupon(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('coupon.name is required');
  } else if (name.length > 64) {
    errors.push('coupon.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('coupon.code is required');
  } else if (code.length > 64) {
    errors.push('coupon.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('coupon.description is required');
  } else if (description.length > 64) {
    errors.push('coupon.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('coupon.owner is required');
  } else if (owner.length > 64) {
    errors.push('coupon.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('coupon.status is required');
  } else if (status.length > 64) {
    errors.push('coupon.status is too long');
  }
  return errors;
}

/** Validates a review payload; returns a list of error messages. */
export function validateReview(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('review.name is required');
  } else if (name.length > 64) {
    errors.push('review.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('review.code is required');
  } else if (code.length > 64) {
    errors.push('review.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('review.description is required');
  } else if (description.length > 64) {
    errors.push('review.description is too long');
  }
  return errors;
}

/** Validates a category payload; returns a list of error messages. */
export function validateCategory(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('category.name is required');
  } else if (name.length > 64) {
    errors.push('category.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('category.code is required');
  } else if (code.length > 64) {
    errors.push('category.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('category.description is required');
  } else if (description.length > 64) {
    errors.push('category.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('category.owner is required');
  } else if (owner.length > 64) {
    errors.push('category.owner is too long');
  }
  return errors;
}

/** Validates a carrier payload; returns a list of error messages. */
export function validateCarrier(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('carrier.name is required');
  } else if (name.length > 64) {
    errors.push('carrier.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('carrier.code is required');
  } else if (code.length > 64) {
    errors.push('carrier.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('carrier.description is required');
  } else if (description.length > 64) {
    errors.push('carrier.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('carrier.owner is required');
  } else if (owner.length > 64) {
    errors.push('carrier.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('carrier.status is required');
  } else if (status.length > 64) {
    errors.push('carrier.status is too long');
  }
  return errors;
}

/** Validates a pallet payload; returns a list of error messages. */
export function validatePallet(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('pallet.name is required');
  } else if (name.length > 64) {
    errors.push('pallet.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('pallet.code is required');
  } else if (code.length > 64) {
    errors.push('pallet.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('pallet.description is required');
  } else if (description.length > 64) {
    errors.push('pallet.description is too long');
  }
  return errors;
}

/** Validates a route payload; returns a list of error messages. */
export function validateRoute(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('route.name is required');
  } else if (name.length > 64) {
    errors.push('route.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('route.code is required');
  } else if (code.length > 64) {
    errors.push('route.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('route.description is required');
  } else if (description.length > 64) {
    errors.push('route.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('route.owner is required');
  } else if (owner.length > 64) {
    errors.push('route.owner is too long');
  }
  return errors;
}

/** Validates a driver payload; returns a list of error messages. */
export function validateDriver(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('driver.name is required');
  } else if (name.length > 64) {
    errors.push('driver.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('driver.code is required');
  } else if (code.length > 64) {
    errors.push('driver.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('driver.description is required');
  } else if (description.length > 64) {
    errors.push('driver.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('driver.owner is required');
  } else if (owner.length > 64) {
    errors.push('driver.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('driver.status is required');
  } else if (status.length > 64) {
    errors.push('driver.status is too long');
  }
  return errors;
}

/** Validates a vehicle payload; returns a list of error messages. */
export function validateVehicle(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('vehicle.name is required');
  } else if (name.length > 64) {
    errors.push('vehicle.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('vehicle.code is required');
  } else if (code.length > 64) {
    errors.push('vehicle.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('vehicle.description is required');
  } else if (description.length > 64) {
    errors.push('vehicle.description is too long');
  }
  return errors;
}

/** Validates a station payload; returns a list of error messages. */
export function validateStation(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('station.name is required');
  } else if (name.length > 64) {
    errors.push('station.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('station.code is required');
  } else if (code.length > 64) {
    errors.push('station.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('station.description is required');
  } else if (description.length > 64) {
    errors.push('station.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('station.owner is required');
  } else if (owner.length > 64) {
    errors.push('station.owner is too long');
  }
  return errors;
}

/** Validates a ticket payload; returns a list of error messages. */
export function validateTicket(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('ticket.name is required');
  } else if (name.length > 64) {
    errors.push('ticket.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('ticket.code is required');
  } else if (code.length > 64) {
    errors.push('ticket.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('ticket.description is required');
  } else if (description.length > 64) {
    errors.push('ticket.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('ticket.owner is required');
  } else if (owner.length > 64) {
    errors.push('ticket.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('ticket.status is required');
  } else if (status.length > 64) {
    errors.push('ticket.status is too long');
  }
  return errors;
}

/** Validates a agent payload; returns a list of error messages. */
export function validateAgent(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('agent.name is required');
  } else if (name.length > 64) {
    errors.push('agent.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('agent.code is required');
  } else if (code.length > 64) {
    errors.push('agent.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('agent.description is required');
  } else if (description.length > 64) {
    errors.push('agent.description is too long');
  }
  return errors;
}

/** Validates a queue payload; returns a list of error messages. */
export function validateQueue(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('queue.name is required');
  } else if (name.length > 64) {
    errors.push('queue.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('queue.code is required');
  } else if (code.length > 64) {
    errors.push('queue.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('queue.description is required');
  } else if (description.length > 64) {
    errors.push('queue.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('queue.owner is required');
  } else if (owner.length > 64) {
    errors.push('queue.owner is too long');
  }
  return errors;
}

/** Validates a region payload; returns a list of error messages. */
export function validateRegion(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('region.name is required');
  } else if (name.length > 64) {
    errors.push('region.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('region.code is required');
  } else if (code.length > 64) {
    errors.push('region.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('region.description is required');
  } else if (description.length > 64) {
    errors.push('region.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('region.owner is required');
  } else if (owner.length > 64) {
    errors.push('region.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('region.status is required');
  } else if (status.length > 64) {
    errors.push('region.status is too long');
  }
  return errors;
}

/** Validates a store payload; returns a list of error messages. */
export function validateStore(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('store.name is required');
  } else if (name.length > 64) {
    errors.push('store.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('store.code is required');
  } else if (code.length > 64) {
    errors.push('store.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('store.description is required');
  } else if (description.length > 64) {
    errors.push('store.description is too long');
  }
  return errors;
}

/** Validates a shelf payload; returns a list of error messages. */
export function validateShelf(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('shelf.name is required');
  } else if (name.length > 64) {
    errors.push('shelf.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('shelf.code is required');
  } else if (code.length > 64) {
    errors.push('shelf.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('shelf.description is required');
  } else if (description.length > 64) {
    errors.push('shelf.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('shelf.owner is required');
  } else if (owner.length > 64) {
    errors.push('shelf.owner is too long');
  }
  return errors;
}

/** Validates a batch payload; returns a list of error messages. */
export function validateBatch(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('batch.name is required');
  } else if (name.length > 64) {
    errors.push('batch.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('batch.code is required');
  } else if (code.length > 64) {
    errors.push('batch.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('batch.description is required');
  } else if (description.length > 64) {
    errors.push('batch.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('batch.owner is required');
  } else if (owner.length > 64) {
    errors.push('batch.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('batch.status is required');
  } else if (status.length > 64) {
    errors.push('batch.status is too long');
  }
  return errors;
}

/** Validates a lot payload; returns a list of error messages. */
export function validateLot(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('lot.name is required');
  } else if (name.length > 64) {
    errors.push('lot.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('lot.code is required');
  } else if (code.length > 64) {
    errors.push('lot.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('lot.description is required');
  } else if (description.length > 64) {
    errors.push('lot.description is too long');
  }
  return errors;
}

/** Validates a contract payload; returns a list of error messages. */
export function validateContract(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('contract.name is required');
  } else if (name.length > 64) {
    errors.push('contract.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('contract.code is required');
  } else if (code.length > 64) {
    errors.push('contract.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('contract.description is required');
  } else if (description.length > 64) {
    errors.push('contract.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('contract.owner is required');
  } else if (owner.length > 64) {
    errors.push('contract.owner is too long');
  }
  return errors;
}

/** Validates a quote payload; returns a list of error messages. */
export function validateQuote(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('quote.name is required');
  } else if (name.length > 64) {
    errors.push('quote.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('quote.code is required');
  } else if (code.length > 64) {
    errors.push('quote.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('quote.description is required');
  } else if (description.length > 64) {
    errors.push('quote.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('quote.owner is required');
  } else if (owner.length > 64) {
    errors.push('quote.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('quote.status is required');
  } else if (status.length > 64) {
    errors.push('quote.status is too long');
  }
  return errors;
}

/** Validates a budget payload; returns a list of error messages. */
export function validateBudget(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('budget.name is required');
  } else if (name.length > 64) {
    errors.push('budget.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('budget.code is required');
  } else if (code.length > 64) {
    errors.push('budget.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('budget.description is required');
  } else if (description.length > 64) {
    errors.push('budget.description is too long');
  }
  return errors;
}

/** Validates a ledger payload; returns a list of error messages. */
export function validateLedger(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('ledger.name is required');
  } else if (name.length > 64) {
    errors.push('ledger.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('ledger.code is required');
  } else if (code.length > 64) {
    errors.push('ledger.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('ledger.description is required');
  } else if (description.length > 64) {
    errors.push('ledger.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('ledger.owner is required');
  } else if (owner.length > 64) {
    errors.push('ledger.owner is too long');
  }
  return errors;
}

/** Validates a receipt payload; returns a list of error messages. */
export function validateReceipt(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('receipt.name is required');
  } else if (name.length > 64) {
    errors.push('receipt.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('receipt.code is required');
  } else if (code.length > 64) {
    errors.push('receipt.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('receipt.description is required');
  } else if (description.length > 64) {
    errors.push('receipt.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('receipt.owner is required');
  } else if (owner.length > 64) {
    errors.push('receipt.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('receipt.status is required');
  } else if (status.length > 64) {
    errors.push('receipt.status is too long');
  }
  return errors;
}

/** Validates a voucher payload; returns a list of error messages. */
export function validateVoucher(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('voucher.name is required');
  } else if (name.length > 64) {
    errors.push('voucher.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('voucher.code is required');
  } else if (code.length > 64) {
    errors.push('voucher.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('voucher.description is required');
  } else if (description.length > 64) {
    errors.push('voucher.description is too long');
  }
  return errors;
}

/** Validates a tariff payload; returns a list of error messages. */
export function validateTariff(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('tariff.name is required');
  } else if (name.length > 64) {
    errors.push('tariff.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('tariff.code is required');
  } else if (code.length > 64) {
    errors.push('tariff.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('tariff.description is required');
  } else if (description.length > 64) {
    errors.push('tariff.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('tariff.owner is required');
  } else if (owner.length > 64) {
    errors.push('tariff.owner is too long');
  }
  return errors;
}

/** Validates a parcel payload; returns a list of error messages. */
export function validateParcel(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('parcel.name is required');
  } else if (name.length > 64) {
    errors.push('parcel.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('parcel.code is required');
  } else if (code.length > 64) {
    errors.push('parcel.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('parcel.description is required');
  } else if (description.length > 64) {
    errors.push('parcel.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('parcel.owner is required');
  } else if (owner.length > 64) {
    errors.push('parcel.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('parcel.status is required');
  } else if (status.length > 64) {
    errors.push('parcel.status is too long');
  }
  return errors;
}

/** Validates a manifest payload; returns a list of error messages. */
export function validateManifest(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('manifest.name is required');
  } else if (name.length > 64) {
    errors.push('manifest.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('manifest.code is required');
  } else if (code.length > 64) {
    errors.push('manifest.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('manifest.description is required');
  } else if (description.length > 64) {
    errors.push('manifest.description is too long');
  }
  return errors;
}

/** Validates a depot payload; returns a list of error messages. */
export function validateDepot(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('depot.name is required');
  } else if (name.length > 64) {
    errors.push('depot.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('depot.code is required');
  } else if (code.length > 64) {
    errors.push('depot.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('depot.description is required');
  } else if (description.length > 64) {
    errors.push('depot.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('depot.owner is required');
  } else if (owner.length > 64) {
    errors.push('depot.owner is too long');
  }
  return errors;
}

/** Validates a zone payload; returns a list of error messages. */
export function validateZone(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('zone.name is required');
  } else if (name.length > 64) {
    errors.push('zone.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('zone.code is required');
  } else if (code.length > 64) {
    errors.push('zone.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('zone.description is required');
  } else if (description.length > 64) {
    errors.push('zone.description is too long');
  }
  const owner = input.owner;
  if (typeof owner !== 'string' || owner.trim() === '') {
    errors.push('zone.owner is required');
  } else if (owner.length > 64) {
    errors.push('zone.owner is too long');
  }
  const status = input.status;
  if (typeof status !== 'string' || status.trim() === '') {
    errors.push('zone.status is required');
  } else if (status.length > 64) {
    errors.push('zone.status is too long');
  }
  return errors;
}

/** Validates a bin payload; returns a list of error messages. */
export function validateBin(input: Input): string[] {
  const errors: string[] = [];
  const name = input.name;
  if (typeof name !== 'string' || name.trim() === '') {
    errors.push('bin.name is required');
  } else if (name.length > 64) {
    errors.push('bin.name is too long');
  }
  const code = input.code;
  if (typeof code !== 'string' || code.trim() === '') {
    errors.push('bin.code is required');
  } else if (code.length > 64) {
    errors.push('bin.code is too long');
  }
  const description = input.description;
  if (typeof description !== 'string' || description.trim() === '') {
    errors.push('bin.description is required');
  } else if (description.length > 64) {
    errors.push('bin.description is too long');
  }
  return errors;
}

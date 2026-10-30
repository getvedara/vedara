"""In-memory CRUD helpers, one block per collection."""

from typing import Any, Dict, List, Optional

Store = Dict[str, Dict[int, Dict[str, Any]]]


def _table(store: Store, name: str) -> Dict[int, Dict[str, Any]]:
    return store.setdefault(name, {})

# ----- accounts -----


def list_accounts(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "accounts").values())
    return rows[:limit]


def get_account(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "accounts").get(record_id)


def create_account(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "accounts")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_account(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "accounts")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_account(store: Store, record_id: int) -> bool:
    rows = _table(store, "accounts")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- addresss -----


def list_addresss(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "addresss").values())
    return rows[:limit]


def get_address(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "addresss").get(record_id)


def create_address(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "addresss")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_address(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "addresss")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_address(store: Store, record_id: int) -> bool:
    rows = _table(store, "addresss")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- invoices -----


def list_invoices(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "invoices").values())
    return rows[:limit]


def get_invoice(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "invoices").get(record_id)


def create_invoice(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "invoices")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_invoice(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "invoices")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_invoice(store: Store, record_id: int) -> bool:
    rows = _table(store, "invoices")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- payments -----


def list_payments(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "payments").values())
    return rows[:limit]


def get_payment(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "payments").get(record_id)


def create_payment(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "payments")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_payment(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "payments")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_payment(store: Store, record_id: int) -> bool:
    rows = _table(store, "payments")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- shipments -----


def list_shipments(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "shipments").values())
    return rows[:limit]


def get_shipment(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "shipments").get(record_id)


def create_shipment(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "shipments")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_shipment(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "shipments")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_shipment(store: Store, record_id: int) -> bool:
    rows = _table(store, "shipments")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- warehouses -----


def list_warehouses(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "warehouses").values())
    return rows[:limit]


def get_warehouse(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "warehouses").get(record_id)


def create_warehouse(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "warehouses")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_warehouse(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "warehouses")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_warehouse(store: Store, record_id: int) -> bool:
    rows = _table(store, "warehouses")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- products -----


def list_products(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "products").values())
    return rows[:limit]


def get_product(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "products").get(record_id)


def create_product(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "products")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_product(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "products")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_product(store: Store, record_id: int) -> bool:
    rows = _table(store, "products")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- suppliers -----


def list_suppliers(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "suppliers").values())
    return rows[:limit]


def get_supplier(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "suppliers").get(record_id)


def create_supplier(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "suppliers")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_supplier(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "suppliers")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_supplier(store: Store, record_id: int) -> bool:
    rows = _table(store, "suppliers")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- customers -----


def list_customers(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "customers").values())
    return rows[:limit]


def get_customer(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "customers").get(record_id)


def create_customer(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "customers")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_customer(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "customers")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_customer(store: Store, record_id: int) -> bool:
    rows = _table(store, "customers")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- orders -----


def list_orders(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "orders").values())
    return rows[:limit]


def get_order(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "orders").get(record_id)


def create_order(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "orders")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_order(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "orders")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_order(store: Store, record_id: int) -> bool:
    rows = _table(store, "orders")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- refunds -----


def list_refunds(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "refunds").values())
    return rows[:limit]


def get_refund(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "refunds").get(record_id)


def create_refund(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "refunds")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_refund(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "refunds")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_refund(store: Store, record_id: int) -> bool:
    rows = _table(store, "refunds")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- coupons -----


def list_coupons(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "coupons").values())
    return rows[:limit]


def get_coupon(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "coupons").get(record_id)


def create_coupon(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "coupons")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_coupon(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "coupons")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_coupon(store: Store, record_id: int) -> bool:
    rows = _table(store, "coupons")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- reviews -----


def list_reviews(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "reviews").values())
    return rows[:limit]


def get_review(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "reviews").get(record_id)


def create_review(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "reviews")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_review(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "reviews")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_review(store: Store, record_id: int) -> bool:
    rows = _table(store, "reviews")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- categorys -----


def list_categorys(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "categorys").values())
    return rows[:limit]


def get_category(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "categorys").get(record_id)


def create_category(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "categorys")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_category(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "categorys")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_category(store: Store, record_id: int) -> bool:
    rows = _table(store, "categorys")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- carriers -----


def list_carriers(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "carriers").values())
    return rows[:limit]


def get_carrier(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "carriers").get(record_id)


def create_carrier(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "carriers")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_carrier(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "carriers")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_carrier(store: Store, record_id: int) -> bool:
    rows = _table(store, "carriers")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- pallets -----


def list_pallets(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "pallets").values())
    return rows[:limit]


def get_pallet(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "pallets").get(record_id)


def create_pallet(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "pallets")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_pallet(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "pallets")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_pallet(store: Store, record_id: int) -> bool:
    rows = _table(store, "pallets")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- routes -----


def list_routes(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "routes").values())
    return rows[:limit]


def get_route(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "routes").get(record_id)


def create_route(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "routes")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_route(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "routes")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_route(store: Store, record_id: int) -> bool:
    rows = _table(store, "routes")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

# ----- drivers -----


def list_drivers(store: Store, limit: int = 50) -> List[Dict[str, Any]]:
    rows = list(_table(store, "drivers").values())
    return rows[:limit]


def get_driver(store: Store, record_id: int) -> Optional[Dict[str, Any]]:
    return _table(store, "drivers").get(record_id)


def create_driver(store: Store, data: Dict[str, Any]) -> Dict[str, Any]:
    rows = _table(store, "drivers")
    record_id = len(rows) + 1
    record = dict(data, id=record_id)
    rows[record_id] = record
    return record


def update_driver(store: Store, record_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rows = _table(store, "drivers")
    if record_id not in rows:
        return None
    rows[record_id] = dict(rows[record_id], **data, id=record_id)
    return rows[record_id]


def delete_driver(store: Store, record_id: int) -> bool:
    rows = _table(store, "drivers")
    if record_id not in rows:
        return False
    del rows[record_id]
    return True

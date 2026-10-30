"""Serializers: one class per entity, each turning a record dict into an API payload."""

from typing import Any, Dict


class BaseSerializer:
    entity = "base"

    def envelope(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {"type": self.entity, "data": payload}


class AccountSerializer(BaseSerializer):
    entity = "account"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class AddressSerializer(BaseSerializer):
    entity = "address"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class InvoiceSerializer(BaseSerializer):
    entity = "invoice"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class PaymentSerializer(BaseSerializer):
    entity = "payment"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class ShipmentSerializer(BaseSerializer):
    entity = "shipment"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class WarehouseSerializer(BaseSerializer):
    entity = "warehouse"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class ProductSerializer(BaseSerializer):
    entity = "product"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class SupplierSerializer(BaseSerializer):
    entity = "supplier"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class CustomerSerializer(BaseSerializer):
    entity = "customer"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class OrderSerializer(BaseSerializer):
    entity = "order"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class RefundSerializer(BaseSerializer):
    entity = "refund"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class CouponSerializer(BaseSerializer):
    entity = "coupon"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class ReviewSerializer(BaseSerializer):
    entity = "review"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class CategorySerializer(BaseSerializer):
    entity = "category"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class CarrierSerializer(BaseSerializer):
    entity = "carrier"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class PalletSerializer(BaseSerializer):
    entity = "pallet"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class RouteSerializer(BaseSerializer):
    entity = "route"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class DriverSerializer(BaseSerializer):
    entity = "driver"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class VehicleSerializer(BaseSerializer):
    entity = "vehicle"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class StationSerializer(BaseSerializer):
    entity = "station"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class TicketSerializer(BaseSerializer):
    entity = "ticket"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class AgentSerializer(BaseSerializer):
    entity = "agent"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class QueueSerializer(BaseSerializer):
    entity = "queue"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class RegionSerializer(BaseSerializer):
    entity = "region"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class StoreSerializer(BaseSerializer):
    entity = "store"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class ShelfSerializer(BaseSerializer):
    entity = "shelf"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class BatchSerializer(BaseSerializer):
    entity = "batch"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class LotSerializer(BaseSerializer):
    entity = "lot"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class ContractSerializer(BaseSerializer):
    entity = "contract"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class QuoteSerializer(BaseSerializer):
    entity = "quote"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class BudgetSerializer(BaseSerializer):
    entity = "budget"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class LedgerSerializer(BaseSerializer):
    entity = "ledger"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class ReceiptSerializer(BaseSerializer):
    entity = "receipt"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class VoucherSerializer(BaseSerializer):
    entity = "voucher"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class TariffSerializer(BaseSerializer):
    entity = "tariff"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class ParcelSerializer(BaseSerializer):
    entity = "parcel"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)


class ManifestSerializer(BaseSerializer):
    entity = "manifest"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        return self.envelope(payload)


class DepotSerializer(BaseSerializer):
    entity = "depot"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        return self.envelope(payload)


class ZoneSerializer(BaseSerializer):
    entity = "zone"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        return self.envelope(payload)


class BinSerializer(BaseSerializer):
    entity = "bin"

    def serialize(self, record: Dict[str, Any]) -> Dict[str, Any]:
        payload: Dict[str, Any] = {}
        payload["id"] = record["id"]
        if record.get("name") is not None:
            payload["name"] = record["name"]
        if record.get("code") is not None:
            payload["code"] = record["code"]
        if record.get("created_at") is not None:
            payload["created_at"] = record["created_at"]
        if record.get("updated_at") is not None:
            payload["updated_at"] = record["updated_at"]
        if record.get("owner") is not None:
            payload["owner"] = record["owner"]
        if record.get("notes") is not None:
            payload["notes"] = record["notes"]
        return self.envelope(payload)

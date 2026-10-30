import inspect
import serializers as s

rec = {"id": 4, "name": "North", "code": "N1"}
assert s.WarehouseSerializer().serialize(rec) == {"type": "warehouse", "data": {"id": 4, "name": "North", "code": "N1"}}
assert s.WarehouseSerializer().serialize(rec, include_id=False) == {"type": "warehouse", "data": {"name": "North", "code": "N1"}}
assert "include_id" not in inspect.signature(s.ProductSerializer.serialize).parameters
assert s.ProductSerializer().serialize(rec)["data"]["id"] == 4
print("ok")

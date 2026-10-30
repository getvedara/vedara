import dataclasses
from shipment import Shipment, heavier

assert dataclasses.is_dataclass(Shipment)
s = Shipment("A1", (1.5, 2.0))
assert s == Shipment("A1", (1.5, 2.0), False)
assert repr(s) == "Shipment(ref='A1', weights=(1.5, 2.0), express=False)"
try:
    s.ref = "B"
    raise AssertionError("must be frozen")
except dataclasses.FrozenInstanceError:
    pass
assert heavier(s, Shipment("B", (4.0,), True)).ref == "B"
assert [f.name for f in dataclasses.fields(Shipment)] == ["ref", "weights", "express"]
print("ok")

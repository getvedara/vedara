from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class Shipment:
    ref: str
    weights: Tuple[float, ...] = ()
    express: bool = False

    def total_weight(self) -> float:
        return sum(self.weights)


def heavier(a: Shipment, b: Shipment) -> Shipment:
    return a if a.total_weight() >= b.total_weight() else b

from typing import Tuple


class Shipment:
    def __init__(self, ref: str, weights: Tuple[float, ...] = (), express: bool = False) -> None:
        self.ref = ref
        self.weights = weights
        self.express = express

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Shipment):
            return NotImplemented
        return (self.ref, self.weights, self.express) == (other.ref, other.weights, other.express)

    def __repr__(self) -> str:
        return f"Shipment(ref={self.ref!r}, weights={self.weights!r}, express={self.express!r})"

    def total_weight(self) -> float:
        return sum(self.weights)


def heavier(a: Shipment, b: Shipment) -> Shipment:
    return a if a.total_weight() >= b.total_weight() else b

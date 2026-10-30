from typing import List, NamedTuple


class Row(NamedTuple):
    name: str
    qty: int
    price: float


def parse_row(line: str) -> Row:
    name, qty, price = (field.strip() for field in line.split(","))
    return Row(name, int(qty), float(price))


def parse_all(text: str) -> List[Row]:
    return [parse_row(line) for line in text.splitlines(keepends=True) if line.strip()]

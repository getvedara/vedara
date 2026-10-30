from typing import Any, Dict, List, Sequence


def top_n(items: Sequence[Any], n: int) -> List[Any]:
    """The n largest items, largest first; ties keep their original order."""
    return sorted(items, reverse=True)[:n]


def top_spenders(customers: List[Dict[str, Any]], n: int = 3) -> List[str]:
    ranked = top_n([(c["total"], -i) for i, c in enumerate(customers)], n)
    return [customers[-neg_index]["name"] for _, neg_index in ranked]

from typing import Any, Callable, Dict, List, Optional, Sequence


def top_n(items: Sequence[Any], n: int, key: Optional[Callable[[Any], Any]] = None) -> List[Any]:
    """The n largest items, largest first; ties keep their original order."""
    if key is None:
        return sorted(items, reverse=True)[:n]
    return sorted(items, key=key, reverse=True)[:n]


def top_spenders(customers: List[Dict[str, Any]], n: int = 3) -> List[str]:
    ranked = top_n(customers, n, key=lambda c: c["total"])
    return [c["name"] for c in ranked]

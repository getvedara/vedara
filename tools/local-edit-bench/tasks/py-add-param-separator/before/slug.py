import re
from typing import Iterable

_NON_WORD = re.compile(r"[^a-z0-9]+")


def slugify(text: str) -> str:
    words = _NON_WORD.split(text.lower())
    slug = "-".join(w for w in words if w)
    return re.sub(r"-{2,}", "-", slug)


def unique_slug(text: str, taken: Iterable[str]) -> str:
    taken = set(taken)
    base = slugify(text)
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"

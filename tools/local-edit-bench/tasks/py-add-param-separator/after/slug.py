import re
from typing import Iterable

_NON_WORD = re.compile(r"[^a-z0-9]+")


def slugify(text: str, separator: str = "-") -> str:
    words = _NON_WORD.split(text.lower())
    slug = separator.join(w for w in words if w)
    return re.sub(f"(?:{re.escape(separator)}){{2,}}", separator, slug)


def unique_slug(text: str, taken: Iterable[str], separator: str = "-") -> str:
    taken = set(taken)
    base = slugify(text, separator=separator)
    if base not in taken:
        return base
    n = 2
    while f"{base}{separator}{n}" in taken:
        n += 1
    return f"{base}{separator}{n}"

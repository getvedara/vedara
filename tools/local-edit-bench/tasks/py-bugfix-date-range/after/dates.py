from datetime import date, timedelta
from typing import List


def date_range(start: date, end: date) -> List[date]:
    """All days from start to end, inclusive."""
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]


def business_days(start: date, end: date) -> List[date]:
    return [d for d in date_range(start, end) if d.weekday() < 5]

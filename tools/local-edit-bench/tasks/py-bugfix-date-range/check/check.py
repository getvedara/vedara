from datetime import date
from dates import business_days, date_range

assert date_range(date(2024, 1, 30), date(2024, 2, 2)) == [date(2024, 1, 30), date(2024, 1, 31), date(2024, 2, 1), date(2024, 2, 2)]
assert date_range(date(2024, 3, 1), date(2024, 3, 1)) == [date(2024, 3, 1)]
assert date_range(date(2024, 3, 2), date(2024, 3, 1)) == []
assert len(business_days(date(2024, 6, 3), date(2024, 6, 9))) == 5
print("ok")

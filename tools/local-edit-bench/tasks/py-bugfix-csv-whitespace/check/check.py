from rows import Row, parse_all, parse_row

assert parse_row("widget , 3 , 2.50") == Row("widget", 3, 2.5)
assert parse_row("gadget,1,9\n") == Row("gadget", 1, 9.0)
assert parse_all("a,1,1\n\n b , 2 , 2 \n") == [Row("a", 1, 1.0), Row("b", 2, 2.0)]
print("ok")

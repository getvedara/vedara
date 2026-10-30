from timer import Timer

ticks = iter([1.0, 3.5, 10.0, 11.0])
clock = lambda: next(ticks)
with Timer(clock) as t:
    pass
assert t.elapsed == 2.5
t2 = Timer(clock)
try:
    with t2:
        raise KeyError("x")
except KeyError:
    pass
else:
    raise AssertionError("exception must propagate")
assert t2.elapsed == 1.0
print("ok")

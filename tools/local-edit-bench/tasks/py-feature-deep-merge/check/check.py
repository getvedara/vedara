import copy
from settings import DEFAULTS, effective, merge_settings

snapshot = copy.deepcopy(DEFAULTS)
e = effective({"editor": {"tab_size": 2}, "theme": "dark"})
assert e == {"theme": "dark", "editor": {"tab_size": 2, "word_wrap": False}, "telemetry": False}
assert DEFAULTS == snapshot
a = {"x": {"y": {"z": 1, "w": 2}}, "k": {"v": 1}}
b = {"x": {"y": {"z": 3}}, "k": 5}
a0, b0 = copy.deepcopy(a), copy.deepcopy(b)
assert merge_settings(a, b) == {"x": {"y": {"z": 3, "w": 2}}, "k": 5}
assert a == a0 and b == b0
print("ok")

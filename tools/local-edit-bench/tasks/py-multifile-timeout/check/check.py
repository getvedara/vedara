import config
import loader

c = loader.load("host = db\ntimeout_seconds = 5  # short\nretries=1\n")
assert c.timeout_seconds == 5 and not hasattr(c, "timeout")
assert c.describe() == "db:8080 (timeout 5s, 1 retries)"
assert config.Config().timeout_seconds == 30
try:
    loader.load("timeout_seconds = 0")
    raise AssertionError("expected ValueError")
except ValueError:
    pass
for f in ("config.py", "loader.py"):
    src = open(f).read()
    assert "timeout_seconds" in src
    assert "timeout:" not in src and ".timeout " not in src and ".timeout}" not in src, f
print("ok")

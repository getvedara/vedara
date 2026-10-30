from tags import add_tag

assert add_tag("Red") == ["red"]
assert add_tag("Blue") == ["blue"]
existing = ["red"]
assert add_tag(" Dark Red ", existing) == ["red", "dark-red"]
assert add_tag("red", existing) is existing
print("ok")

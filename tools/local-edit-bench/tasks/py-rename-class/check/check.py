import climate

assert not hasattr(climate, "Thermostat")
c = climate.ClimateController("hall", 20.0)
c.record(19.0)
assert c.needs_heating()
assert repr(c) == "ClimateController(room='hall', target=20.0)"
assert [type(x).__name__ for x in climate.for_rooms(["a", "b"])] == ["ClimateController", "ClimateController"]
print("ok")

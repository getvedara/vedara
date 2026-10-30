from ranking import top_n, top_spenders

assert top_n([3, 1, 2], 2) == [3, 2]
words = ["bb", "a", "ccc", "dd"]
assert top_n(words, 3, key=len) == ["ccc", "bb", "dd"]
people = [{"name": "ann", "total": 5}, {"name": "bo", "total": 9}, {"name": "cy", "total": 5}, {"name": "di", "total": 1}]
assert top_spenders(people) == ["bo", "ann", "cy"]
assert top_spenders(people, 1) == ["bo"]
print("ok")

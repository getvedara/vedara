from life import render, step

blinker = [[0, 0, 0], [1, 1, 1], [0, 0, 0]]
assert step(blinker) == [[0, 1, 0], [0, 1, 0], [0, 1, 0]]
assert step(step(blinker)) == blinker
block = [[1, 1], [1, 1]]
assert step(block) == block
assert render(step([[1, 0], [0, 0]])) == "..\n.."
print("ok")

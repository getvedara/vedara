from typing import List

Grid = List[List[int]]


def step(grid: Grid) -> Grid:
    rows = len(grid)
    cols = len(grid[0]) if rows else 0
    result: Grid = [[0] * cols for _ in range(rows)]
    for r in range(rows):
        for c in range(cols):
            live = 0
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < rows and 0 <= cc < cols:
                        live += grid[rr][cc]
            if grid[r][c]:
                result[r][c] = 1 if live in (2, 3) else 0
            else:
                result[r][c] = 1 if live == 3 else 0
    return result


def render(grid: Grid) -> str:
    return "\n".join("".join("#" if v else "." for v in row) for row in grid)

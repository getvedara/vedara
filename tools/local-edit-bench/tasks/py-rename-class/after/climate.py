from typing import List


class ClimateController:
    def __init__(self, room: str, target: float = 21.0) -> None:
        self.room = room
        self.target = target
        self.history: List[float] = []

    def record(self, reading: float) -> None:
        self.history.append(reading)

    def needs_heating(self) -> bool:
        return bool(self.history) and self.history[-1] < self.target - 0.5

    def __repr__(self) -> str:
        return f"ClimateController(room={self.room!r}, target={self.target})"


def for_rooms(rooms: List[str]) -> List[ClimateController]:
    return [ClimateController(room) for room in rooms]

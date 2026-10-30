import time
from typing import Callable, Optional


class Timer:
    def __init__(self, clock: Callable[[], float] = time.perf_counter) -> None:
        self._clock = clock
        self._started: Optional[float] = None
        self.elapsed = 0.0

    def start(self) -> None:
        self._started = self._clock()

    def stop(self) -> float:
        if self._started is None:
            raise RuntimeError("timer was not started")
        self.elapsed += self._clock() - self._started
        self._started = None
        return self.elapsed

    def __enter__(self) -> "Timer":
        self.start()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.stop()

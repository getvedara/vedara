from dataclasses import dataclass


@dataclass
class Config:
    host: str = "localhost"
    port: int = 8080
    timeout: int = 30
    retries: int = 3

    def describe(self) -> str:
        return f"{self.host}:{self.port} (timeout {self.timeout}s, {self.retries} retries)"

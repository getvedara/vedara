from typing import Dict

from config import Config


def parse_lines(text: str) -> Dict[str, str]:
    result: Dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        key, _, value = line.partition("=")
        result[key.strip()] = value.strip()
    return result


def load(text: str) -> Config:
    values = parse_lines(text)
    cfg = Config()
    if "host" in values:
        cfg.host = values["host"]
    if "port" in values:
        cfg.port = int(values["port"])
    if "timeout_seconds" in values:
        cfg.timeout_seconds = int(values["timeout_seconds"])
        if cfg.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
    if "retries" in values:
        cfg.retries = int(values["retries"])
    return cfg

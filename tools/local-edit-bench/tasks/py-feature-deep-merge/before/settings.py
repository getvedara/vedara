from typing import Any, Dict

DEFAULTS: Dict[str, Any] = {
    "theme": "light",
    "editor": {"tab_size": 4, "word_wrap": False},
    "telemetry": False,
}


def merge_settings(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(base)
    for key, value in override.items():
        result[key] = value
    return result


def effective(user: Dict[str, Any]) -> Dict[str, Any]:
    return merge_settings(DEFAULTS, user)

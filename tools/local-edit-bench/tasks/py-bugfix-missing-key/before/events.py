from typing import Any, Dict


def summarize_event(event: Dict[str, Any]) -> str:
    title = event["title"]
    location = event["location"]
    count = len(event["attendees"])
    noun = "attendee" if count == 1 else "attendees"
    return f"{title} @ {location} ({count} {noun})"

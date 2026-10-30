from events import summarize_event

assert summarize_event({"title": "Standup"}) == "Standup @ online (0 attendees)"
assert summarize_event({"title": "Demo", "location": "Room 4", "attendees": ["a"]}) == "Demo @ Room 4 (1 attendee)"
print("ok")

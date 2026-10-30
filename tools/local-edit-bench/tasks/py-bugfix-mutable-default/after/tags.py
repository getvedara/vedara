def normalize(tag):
    return tag.strip().lower().replace(" ", "-")


def add_tag(tag, tags=None):
    if tags is None:
        tags = []
    tag = normalize(tag)
    if tag not in tags:
        tags.append(tag)
    return tags

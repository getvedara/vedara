from slug import slugify, unique_slug

assert slugify("Hello,  World!") == "hello-world"
assert slugify("Hello,  World!", separator="_") == "hello_world"
assert unique_slug("My Post", ["my-post"]) == "my-post-2"
assert unique_slug("My Post", ["my_post", "my_post_2"], separator="_") == "my_post_3"
assert unique_slug("New", []) == "new"
print("ok")

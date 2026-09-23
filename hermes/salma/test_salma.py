"""Salma's rules, checked without the network: `python3 test_salma.py`.

The ones that decide what reaches a client's account are here on purpose:
who posts, when, and why not.
"""

import io

import salma

NOW = "2026-10-10T08:00:00Z"
ON = {"active": True, "publishing": True, "publishing_since": "2026-10-01T00:00:00Z",
      "auto_approve": False, "platforms": ["instagram", "facebook"],
      "ig_user_id": "17841", "fb_page_id": "1099"}
POST = {"id": "c:2026-10:1", "scheduled_at": "2026-10-10T07:00:00Z", "caption": "Words",
        "media": [{"kind": "image", "url": "https://x/1.jpg", "source": "upload"}],
        "client_status": "approved", "aspect": "4:5"}


def test_publish_decision():
    assert salma.publish_decision(POST, None, NOW) == (False, "")
    assert salma.publish_decision(POST, {**ON, "publishing": False}, NOW) == (False, "")
    assert salma.publish_decision(POST, {**ON, "active": False}, NOW) == (False, "")
    # Not due yet, and due before the client was switched on: silent.
    assert salma.publish_decision({**POST, "scheduled_at": "2026-10-11T07:00:00Z"}, ON, NOW) == (False, "")
    assert salma.publish_decision({**POST, "scheduled_at": "2026-09-30T07:00:00Z"}, ON, NOW) == (False, "")
    # Due but not finished, or not approved: said on the post.
    ok, why = salma.publish_decision({**POST, "caption": " "}, ON, NOW)
    assert not ok and "Not finished" in why
    ok, why = salma.publish_decision({**POST, "media": [], "images": []}, ON, NOW)
    assert not ok and "Not finished" in why
    for status in (None, "sent", "changes", "changed"):
        ok, why = salma.publish_decision({**POST, "client_status": status}, ON, NOW)
        assert not ok and "not approved" in why, status
    assert salma.publish_decision(POST, ON, NOW) == (True, "")
    # A client who does not sign off posts any finished post.
    assert salma.publish_decision({**POST, "client_status": None}, {**ON, "auto_approve": True}, NOW) == (True, "")


def test_targets():
    assert salma.targets_of(POST, ON) == (["instagram", "facebook"], [])
    go, why = salma.targets_of({**POST, "platforms": ["instagram"]}, ON)
    assert go == ["instagram"] and not why
    go, why = salma.targets_of(POST, {**ON, "ig_user_id": None})
    assert go == ["facebook"] and "no Instagram account" in why[0]
    go, why = salma.targets_of({**POST, "aspect": "3:4"}, ON)
    assert go == ["facebook"] and "3:4" in why[0]
    # A lone video is a Reel whatever the post's shape says.
    reel = {**POST, "aspect": "3:4", "media": [{"kind": "video", "url": "https://x/v.mp4"}]}
    assert salma.targets_of(reel, ON)[0] == ["instagram", "facebook"]
    go, why = salma.targets_of(POST, {**ON, "fb_page_id": None})
    assert go == ["instagram"] and "not linked to a Page" in why[0]
    # A client who only has Instagram never gets Facebook, whatever the post asks.
    go, _ = salma.targets_of(POST, {**ON, "platforms": ["instagram"]})
    assert go == ["instagram"]


class Fake:
    def __init__(self, media, prompts=None):
        self.row = {"media": media, "prompts": prompts or []}

    def get(self, path):
        return [dict(self.row)]

    def patch(self, path, body, prefer=""):
        self.row.update(body)


def test_place_drawn():
    up = lambda u: {"kind": "image", "url": u, "source": "upload"}
    ai = lambda u: {"kind": "image", "url": u, "source": "ai"}
    f = Fake([ai("a1"), up("u1"), ai("a2")])
    salma.place_drawn(f, "x", ["n1", "n2"], ["q1", "q2"], index=None, target="", add=False, done=True)
    assert [m["url"] for m in f.row["media"]] == ["n1", "u1", "n2"]
    f = Fake([ai("a1"), ai("a2"), ai("a3")])
    salma.place_drawn(f, "x", ["n1"], ["q"], index=None, target="", add=False, done=False)
    assert [m["url"] for m in f.row["media"]] == ["n1", "a2", "a3"]
    f = Fake([up("u1"), ai("a2")])
    salma.place_drawn(f, "x", ["n2"], ["q"], index=0, target="a2", add=False, done=True)
    assert [m["url"] for m in f.row["media"]] == ["u1", "n2"]
    f = Fake([up("u1")])
    salma.place_drawn(f, "x", ["n9"], ["q9"], index=None, target="", add=True, done=True)
    assert [m["url"] for m in f.row["media"]] == ["u1", "n9"]


def test_fit_jpeg():
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (1792, 1008), "white").save(buf, "PNG")
    for aspect, (_, size, _) in salma.SHAPES.items():
        out = Image.open(io.BytesIO(salma.fit_jpeg(buf.getvalue(), size)))
        assert out.size == size and out.format == "JPEG", aspect


def test_strip_codes():
    assert salma.strip_codes("Bronze (#4A3B2A) finish #facade") == "Bronze finish #facade"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")

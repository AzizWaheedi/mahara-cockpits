"""Salma's rules, checked without the network: `python3 test_salma.py`.

The ones that decide what reaches a client's account are here on purpose:
who posts, when, and why not.
"""

import contextlib
import io
import os
import tempfile

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


def test_api_shapes():
    # Every shape a post or a Reel cover asks for is one the API model draws.
    for draw_as, _, _ in salma.SHAPES.values():
        assert salma.HF_API_DRAW.get(draw_as, draw_as) in salma.HF_API_ASPECTS, draw_as
    assert "9:16" in salma.HF_API_ASPECTS


class FakeHiggsfield:
    """The API's answers in order, and what was sent, kept for checking."""

    def __init__(self, *answers):
        self.answers, self.sent = list(answers), []

    def __call__(self, method, url, body=None):
        self.sent.append((method, url, body))
        return self.answers.pop(0)


@contextlib.contextmanager
def api(*answers):
    from PIL import Image

    buf = io.BytesIO()
    Image.effect_noise((300, 300), 60).convert("RGB").save(buf, "PNG")
    fake = FakeHiggsfield(*answers)
    saved = (salma.hf_api, salma.fetch_bytes, salma.HF_POLL_S, salma.HF_WALLET_FILE)
    env = {k: os.environ.pop(k, None) for k in ("HF_KEY", "SALMA_IMAGES")}
    with tempfile.TemporaryDirectory() as d:
        salma.hf_api, salma.HF_POLL_S = fake, 0
        salma.fetch_bytes = lambda url: buf.getvalue()
        salma.HF_WALLET_FILE = os.path.join(d, "wallet.json")
        os.environ["HF_KEY"] = "id:secret"
        try:
            yield fake
        finally:
            salma.hf_api, salma.fetch_bytes, salma.HF_POLL_S, salma.HF_WALLET_FILE = saved
            for k, v in env.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


SUBMITTED = (200, {"request_id": "r1", "status_url": "https://api.higgsfield.ai/requests/r1/status",
                   "cancel_url": "https://api.higgsfield.ai/requests/r1/cancel"})


def test_api_picture():
    done = (200, {"status": "completed", "images": [{"url": "https://cdn.example/r1.png"}]})
    with api(SUBMITTED, (200, {"status": "queued"}), (200, {"status": "in_progress"}), done) as hf:
        assert salma.images_via() == "api"
        jpeg = salma.hf_image("a villa", ["/tmp/frame.jpg", "https://x/ref.jpg"], aspect="4:5")
        assert jpeg[:2] == b"\xff\xd8"
        method, url, body = hf.sent[0]
        assert method == "POST" and url.endswith("/" + salma.HF_API_MODEL)
        # 4:5 is drawn 3:4; only links go to the API, a local path cannot.
        assert body["aspect_ratio"] == "3:4" and body["image_urls"] == ["https://x/ref.jpg"]
        assert salma.wallet_state() == "ok"
    with api(SUBMITTED, done) as hf:
        salma.hf_image("a villa", [], aspect="9:16")
        assert "image_urls" not in hf.sent[0][2] and hf.sent[0][2]["aspect_ratio"] == "9:16"
    with api() as hf:
        os.environ["SALMA_IMAGES"] = "cli"
        assert salma.images_via() == "cli"


def test_api_refusals():
    with api((403, {"detail": "not_enough_credits"})):
        try:
            salma.hf_image("x")
            raise AssertionError("an empty wallet must stop the picture")
        except salma.NoCredits as e:
            assert "wallet is empty" in str(e) and "open.higgsfield.ai/billing" in str(e)
        assert salma.wallet_state() == "empty"
    for answers, words in [
        (((401, {"detail": "Invalid credentials"}),), "refused the API key"),
        ((SUBMITTED, (200, {"status": "nsfw"})), "safety check"),
        ((SUBMITTED, (200, {"status": "failed", "error": "boom"})), "could not make the picture: boom"),
        ((SUBMITTED, (200, {"status": "canceled"})), "cancelled"),
        ((SUBMITTED, (200, {"status": "completed", "images": []})), "no picture back"),
    ]:
        with api(*answers):
            try:
                salma.hf_image("x")
                raise AssertionError(words)
            except salma.NoCredits:
                raise AssertionError(f"not a credits problem: {words}")
            except RuntimeError as e:
                assert words in str(e), (words, str(e))


def test_words_read_back():
    import looks

    # The slip from 2026-09-24's Reel cover: the second qaf of تشققات drawn
    # as a shadda. A reader that transcribes what is drawn must not pass it.
    ok, missing = looks.words_match(["شكل ظل مرتب", "بدون تشققات"], "شكل ظل مرتب\nبدون تشقّات")
    assert not ok and missing == ["بدون تشققات"]
    # Line breaks, spacing, punctuation and tatweel do not matter; letters do.
    ok, _ = looks.words_match(["نتابع كل مرحلة بنفسنا.. من الأساس لين التسليم"],
                              "نتابع كل مرحلة بنفسنا..\nمن الأسـاس لين التسليم")
    assert ok
    # A reader's Persian kaf is the same letter on the picture.
    ok, _ = looks.words_match(["شكل ظل مرتب"], "شکل ظل مرتب")
    assert ok
    ok, missing = looks.words_match(["VILLA AL SIDRA"], "Villa al Sidra · Doha")
    assert ok and not missing
    assert looks.slide_lines({"headline": "أ", "line": "ب", "accent": "أ"}) == ["أ", "ب"]


def test_clean_words():
    import looks

    w = looks.clean_words({"headline": "الشباك الرخيص يطلع عليك غالي", "accent": "غالي",
                           "line": "  x — y ", "extra": "no"}, "bold")
    assert w == {"headline": "الشباك الرخيص يطلع عليك غالي", "line": "x y", "accent": "غالي"}
    # An accent that is not in the headline would colour nothing: dropped.
    assert "accent" not in looks.clean_words({"headline": "a", "accent": "b"}, "bold")
    assert looks.clean_words({"title": "فيلا", "headline": "no"}, "showcase") == {"title": "فيلا"}
    assert looks.look_of({"look": "showcase"}) == "showcase"
    assert looks.look_of({"look": "odd"}) == looks.look_of(None) == "bold"


def test_prompts():
    import looks

    p = looks.bold_prompt("sand pours through a gap", {"headline": "الشباك الرخيص", "accent": "الرخيص"},
                          client_line="X", handle="@x", cover_anchor=True, role="slide")
    assert '"الشباك الرخيص"' in p and "every dot exactly as given" in p and "Image 1" in p
    assert "@x" in p and "no duplicate text" in p
    assert "Arabic" not in looks.bold_prompt("s", {"headline": "Cheap windows cost more"}, client_line="X")
    assert "No text" in looks.showcase_prompt("a villa at dusk")
    m = looks.motion_prompt({"camera": "A slow dolly-in", "person": "a man walks", "motion": "palms sway"})
    assert m.startswith("A slow dolly-in.") and "a man walks." in m and "No text" in m
    assert looks.motion_prompt({}).startswith("A slow, smooth, steady dolly-in")


def test_ffmpeg_args():
    import looks

    a = looks.ffmpeg_args("in.mp4", "w.png", "out.mp4", (1080, 1920))
    graph = a[a.index("-filter_complex") + 1]
    assert "crop=1080:1920" in graph and "overlay=0:0" in graph and a[-1] == "out.mp4"
    assert a.count("-i") == 2
    b = looks.ffmpeg_args("in.mp4", None, "out.mp4", (1080, 1350), pad=True)
    graph = b[b.index("-filter_complex") + 1]
    assert "gblur" in graph and "overlay" in graph and b.count("-i") == 1


def test_words_layer():
    import looks
    from PIL import Image

    ready, why = looks.fonts_ready()
    if not ready:
        print(f"  (skipped the layer: {why})")
        return
    words = {"title": "فيلا السدرة", "line": "Villa Al Sidra · Doha",
             "cta": "احجز استشارتك المجانية", "handle": "@sampleclient"}
    for size in ((1080, 1920), (1080, 1350), (1080, 1080), (1080, 566)):
        layer = Image.open(io.BytesIO(looks.render_layer(words, size)))
        assert layer.size == size and layer.mode == "RGBA"
        # Words drawn: some pixels are near-opaque ink, and the middle of the
        # frame (the building) is left clear.
        alpha = layer.getchannel("A")
        assert alpha.getextrema()[1] > 200
        w, h = size
        assert alpha.crop((0, int(h * 0.45), w, int(h * 0.55))).getextrema()[1] == 0
    pic = io.BytesIO()
    Image.new("RGB", (1500, 2000), (30, 60, 120)).save(pic, "JPEG")
    out = Image.open(io.BytesIO(looks.compose(pic.getvalue(), looks.render_layer(words, (1080, 1350)), (1080, 1350))))
    assert out.size == (1080, 1350) and out.format == "JPEG"


def test_tone():
    import looks
    from PIL import Image

    def pic(colour):
        b = io.BytesIO()
        Image.new("RGB", (800, 1000), colour).save(b, "JPEG")
        return b.getvalue()

    # Bright where the title sits: dark words. A dusk sky: light words.
    assert looks.tone_of(pic((235, 228, 215)), (1080, 1350)) == "dark"
    assert looks.tone_of(pic((25, 45, 90)), (1080, 1350)) == "light"
    assert looks.tone_of(None, (1080, 1350)) == "light"


def test_place_items_with_words():
    ai = lambda u: {"kind": "image", "url": u, "source": "ai"}
    f = Fake([ai("a1"), {"kind": "image", "url": "u1", "source": "upload"}])
    new = {"kind": "image", "url": "n1", "source": "ai", "look": "showcase", "clean": "c1",
           "words": {"title": "فيلا"}}
    salma.place_drawn(f, "x", [new], ["q"], index=0, target="a1", add=False, done=True)
    assert f.row["media"][0] == new and f.row["images"] == ["n1", "u1"]


def test_alert_once():
    sent = []
    saved = salma.slack_alert
    salma.slack_alert = lambda text: sent.append(text) or True
    try:
        f = Fake([])
        post = {"id": "c:1", "alerts": {}}
        salma.alert_once(f, post, "failed:abc", "it did not go out")
        salma.alert_once(f, post, "failed:abc", "it did not go out")
        assert len(sent) == 1 and "it did not go out" in sent[0] and salma.CALENDAR_URL in sent[0]
        assert "failed:abc" in f.row["alerts"]
    finally:
        salma.slack_alert = saved


def test_motion_refuses_drawn_words():
    f = Fake([{"kind": "image", "url": "b1", "source": "ai", "look": "bold",
               "words": {"headline": "كلمة"}}])
    try:
        salma.do_motion(f, {"post_id": "x", "params": {"index": 0}})
        raise AssertionError("a picture with drawn words must not move")
    except ValueError as e:
        assert "bending them" in str(e)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print(f"ok {name}")

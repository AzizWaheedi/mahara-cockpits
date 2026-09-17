import unittest
from datetime import datetime, timedelta, timezone

from radar.models import Post
from radar.outliers import compute_baseline, find_candidates, tier_for, trimmed_median


def post(i, views, hours_ago, pinned=False, followers=50000, likes=None):
    now = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)
    return Post(
        platform="instagram",
        post_id=f"p{i}",
        url=f"https://www.instagram.com/reel/p{i}/",
        author_handle="acct",
        author_followers=followers,
        posted_at=(now - timedelta(hours=hours_ago)).isoformat().replace("+00:00", "Z"),
        views=views,
        likes=likes,
        is_pinned=pinned,
    )


NOW = datetime(2026, 9, 17, 12, 0, tzinfo=timezone.utc)


class TrimmedMedianTests(unittest.TestCase):
    def test_small_sets(self):
        self.assertIsNone(trimmed_median([]))
        self.assertEqual(trimmed_median([10]), 10)
        self.assertEqual(trimmed_median([10, 30]), 20)
        self.assertEqual(trimmed_median([10, 20, 30]), 20)

    def test_one_viral_post_does_not_move_the_baseline(self):
        plain = [1000] * 9
        self.assertEqual(trimmed_median(plain + [900000]), 1000)
        # Raw median would also survive here; the trim matters with two spikes.
        self.assertEqual(trimmed_median([1000] * 8 + [500000, 900000]), 1000)

    def test_trim_drops_both_ends(self):
        vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]
        # n=10, k=1 -> core 2..9 -> median 5.5
        self.assertEqual(trimmed_median(vals), 5.5)


class BaselineTests(unittest.TestCase):
    def test_needs_min_n_settled_posts(self):
        posts = [post(i, 1000, hours_ago=200 + i) for i in range(7)]
        self.assertIsNone(compute_baseline(posts, now=NOW, min_n=8, floor=0))
        posts.append(post(9, 1000, hours_ago=300))
        b = compute_baseline(posts, now=NOW, min_n=8, floor=0)
        self.assertIsNotNone(b)
        self.assertEqual(b.n, 8)
        self.assertEqual(b.median, 1000)
        self.assertEqual(b.confidence, "low")
        self.assertIn("leave_one_out", b.rules)

    def test_young_pinned_and_other_kind_posts_excluded(self):
        posts = [post(i, 1000, hours_ago=200 + i) for i in range(9)]
        posts.append(post(90, 50000, hours_ago=100))  # under seven days: excluded from the baseline
        posts.append(post(91, 80000, hours_ago=300, pinned=True))  # pinned: excluded
        photo = post(92, 90000, hours_ago=300)
        photo.is_video = False  # other kind: excluded
        posts.append(photo)
        b = compute_baseline(posts, now=NOW, floor=0, is_video=True)
        self.assertEqual(b.n, 9)
        self.assertEqual(b.median, 1000)

    def test_leave_one_out_and_floor(self):
        posts = [post(i, 300, hours_ago=200 + i) for i in range(9)] + [post(50, 30000, hours_ago=250)]
        with_it = compute_baseline(posts, now=NOW, floor=0)
        without = compute_baseline(posts, now=NOW, floor=0, exclude_key="instagram:p50")
        self.assertEqual(without.n, with_it.n - 1)
        self.assertEqual(without.median, 300)
        floored = compute_baseline(posts, now=NOW, floor=1000, exclude_key="instagram:p50")
        self.assertTrue(floored.floored)
        self.assertEqual(floored.median, 1000)
        self.assertEqual(floored.raw_median, 300)

    def test_sample_size_takes_newest(self):
        old = [post(i, 100, hours_ago=2000 + i) for i in range(10)]
        new = [post(100 + i, 5000, hours_ago=200 + i) for i in range(10)]
        b = compute_baseline(old + new, now=NOW, sample_size=10, floor=0)
        self.assertEqual(b.median, 5000)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        # Ten settled posts around 1,000 views form the baseline.
        self.posts = [post(i, 1000 + i, hours_ago=200 + i) for i in range(10)]

    def test_tiers(self):
        self.assertEqual(tier_for(2.9), "noise")
        self.assertEqual(tier_for(3.0), "study")
        self.assertEqual(tier_for(4.99), "study")
        self.assertEqual(tier_for(5.0), "reverse_engineer")

    def test_finds_only_outliers_old_enough_in_window_and_past_the_gate(self):
        posts = list(self.posts)
        posts.append(post(50, 3500, hours_ago=72))  # 3.5x, provisional (72h checkpoint)
        posts.append(post(51, 9000, hours_ago=96, likes=900))  # about 9x: reverse engineer
        posts.append(post(52, 20000, hours_ago=10))  # under 24 hours: not scored
        posts.append(post(53, 20000, hours_ago=24 * 45))  # outside the 30 day window
        posts.append(post(54, 2500, hours_ago=80))  # 2.5x: noise
        posts.append(post(55, 4000, hours_ago=300))  # settled: 4x locked, but in the baseline pool of the others too
        cands = find_candidates(posts, now=NOW, target_key="instagram:account:acct", industry="ours", floor=1000)
        ids = {c.post.post_id: c for c in cands}
        self.assertEqual(set(ids), {"p50", "p51", "p55"})
        self.assertEqual(ids["p51"].tier, "reverse_engineer")
        self.assertTrue(ids["p51"].provisional)
        self.assertEqual(ids["p51"].checkpoint, "72h")
        self.assertAlmostEqual(ids["p51"].engagement_rate, 0.1)
        self.assertFalse(ids["p55"].provisional)
        self.assertEqual(ids["p55"].checkpoint, "7d")
        self.assertIsNotNone(ids["p51"].robust_z)
        self.assertGreater(ids["p51"].robust_z, 3.5)
        self.assertEqual(cands[0].post.post_id, "p51")  # reverse engineer first

    def test_views_gate_blocks_tiny_spikes_without_engagement(self):
        posts = [post(i, 200, hours_ago=200 + i) for i in range(9)]
        posts.append(post(60, 2500, hours_ago=72))  # 2.5x the 1,000 floor, under 3x floor, no engagement
        self.assertEqual(find_candidates(posts, now=NOW, target_key="k", industry="other", floor=1000), [])
        posts.append(post(61, 2900, hours_ago=72, likes=300))  # 2.9x is noise regardless
        posts.append(post(62, 3100, hours_ago=72, likes=100))  # 3.1x and 3.2 percent engagement: proposed
        cands = find_candidates(posts, now=NOW, target_key="k", industry="other", floor=1000)
        self.assertEqual([c.post.post_id for c in cands], ["p62"])
        self.assertTrue(cands[0].baseline.floored)

    def test_packaging_only_flag_for_tiny_accounts(self):
        posts = list(self.posts) + [post(60, 50000, hours_ago=72, followers=300)]
        cands = find_candidates(posts, now=NOW, target_key="k", industry="other", floor=1000)
        self.assertTrue(cands[0].packaging_only)


if __name__ == "__main__":
    unittest.main()

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
    def test_needs_min_n_eligible_posts(self):
        posts = [post(i, 1000, hours_ago=100) for i in range(4)]
        self.assertIsNone(compute_baseline(posts, now=NOW))
        posts.append(post(9, 1000, hours_ago=100))
        b = compute_baseline(posts, now=NOW)
        self.assertIsNotNone(b)
        self.assertEqual(b.n, 5)
        self.assertEqual(b.median, 1000)

    def test_young_and_pinned_posts_excluded(self):
        posts = [post(i, 1000, hours_ago=100) for i in range(6)]
        posts.append(post(90, 50000, hours_ago=5))  # too young: excluded
        posts.append(post(91, 80000, hours_ago=300, pinned=True))  # pinned: excluded
        b = compute_baseline(posts, now=NOW)
        self.assertEqual(b.n, 6)
        self.assertEqual(b.median, 1000)

    def test_sample_size_takes_newest(self):
        old = [post(i, 100, hours_ago=2000 + i) for i in range(10)]
        new = [post(100 + i, 5000, hours_ago=100 + i) for i in range(10)]
        b = compute_baseline(old + new, now=NOW, sample_size=10)
        self.assertEqual(b.median, 5000)


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.posts = [post(i, 1000 + i, hours_ago=100 + i) for i in range(10)]
        self.base = compute_baseline(self.posts, now=NOW)

    def test_tiers(self):
        self.assertEqual(tier_for(2.9), "noise")
        self.assertEqual(tier_for(3.0), "study")
        self.assertEqual(tier_for(4.99), "study")
        self.assertEqual(tier_for(5.0), "reverse_engineer")

    def test_finds_only_outliers_old_enough_and_in_window(self):
        posts = list(self.posts)
        posts.append(post(50, 3500, hours_ago=72))  # 3.5x: study
        posts.append(post(51, 9000, hours_ago=96, likes=900))  # ~9x: reverse engineer
        posts.append(post(52, 20000, hours_ago=10))  # too young
        posts.append(post(53, 20000, hours_ago=24 * 45))  # outside 30 day window
        posts.append(post(54, 2500, hours_ago=80))  # 2.5x: noise
        cands = find_candidates(posts, self.base, now=NOW, target_key="instagram:account:acct", industry="ours")
        ids = [c.post.post_id for c in cands]
        self.assertEqual(ids, ["p51", "p50"])  # sorted by multiplier desc
        self.assertEqual(cands[0].tier, "reverse_engineer")
        self.assertEqual(cands[1].tier, "study")
        self.assertAlmostEqual(cands[0].engagement_rate, 0.1)
        self.assertFalse(cands[0].packaging_only)

    def test_packaging_only_flag_for_tiny_accounts(self):
        posts = list(self.posts) + [post(60, 50000, hours_ago=72, followers=300)]
        cands = find_candidates(posts, self.base, now=NOW, target_key="k", industry="other")
        self.assertTrue(cands[0].packaging_only)


if __name__ == "__main__":
    unittest.main()

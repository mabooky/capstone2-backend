import unittest
from collections import Counter
from decimal import Decimal as D
from fractions import Fraction

from clean_muse import MUSIC, classify, load_configs, normalize, select_hash_trial, transform


class MuseCleanerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.configs = load_configs(MUSIC / 'db/002_normalization_v1.sql')

    def test_theoretical_endpoints_and_below_one(self):
        self.assertEqual(normalize(D(0), D(0), D(9)), D(-1))
        self.assertEqual(normalize(D(9), D(0), D(9)), D(1))
        self.assertLess(normalize(D('.5'), D(0), D(9)), 0)

    def test_all_observed_endpoints(self):
        for metric in ('valence', 'arousal'):
            cfg = self.configs[('muse-observed-v1', metric)]
            lo, hi = D(cfg['raw_min']), D(cfg['raw_max'])
            self.assertEqual(normalize(lo, lo, hi), -1)
            self.assertEqual(normalize(hi, lo, hi), 1)

    def test_normalization_against_independent_exact_rational(self):
        for metric in ('valence', 'arousal'):
            for version in ('muse-theoretical-v1', 'muse-observed-v1'):
                cfg = self.configs[(version, metric)]
                lo, hi, raw = D(cfg['raw_min']), D(cfg['raw_max']), D('.5')
                exact = 2 * (Fraction(raw) - Fraction(lo)) / (Fraction(hi) - Fraction(lo)) - 1
                self.assertLess(abs(Fraction(normalize(raw, lo, hi)) - exact), Fraction(1, 10**48))

    def test_invalid_bounds_and_out_of_range_rejected(self):
        for raw, lo, hi in [(0, 0, 0), (0, 1, 0), (-1, 0, 9), (10, 0, 9)]:
            with self.assertRaises(ValueError):
                normalize(D(raw), D(lo), D(hi))

    def test_nonfinite_rejected(self):
        for raw in ('NaN', 'Infinity', '-Infinity'):
            with self.assertRaises(ValueError):
                normalize(D(raw), D(0), D(9))

    def test_duplicate_classification_uses_whole_population(self):
        spotify = 'A' * 22
        self.assertEqual(classify({'spotify_id': spotify}, Counter({spotify: 2})), 'duplicate_spotify_id')
        self.assertEqual(classify({'spotify_id': spotify}, Counter({spotify: 1})), 'unique_unverified')

    def test_missing_and_invalid_ids_are_distinct(self):
        self.assertEqual(classify({'spotify_id': ''}, Counter()), 'missing_spotify_id')
        self.assertEqual(classify({'spotify_id': 'bad'}, Counter()), 'invalid_spotify_id')

    def test_source_and_four_scores_preserve_original(self):
        raw = dict(id='sample', track='Title', artist='Artist', valence_tags='0.5000',
                   arousal_tags='0.7500', dominance_tags='2.10', mbid='', spotify_id='')
        before = dict(raw)
        source, scores, category = transform(raw, Counter(), self.configs, '2026-10-17T00:00:00+00:00')
        self.assertEqual(raw, before)
        self.assertEqual(source['raw_payload'], before)
        self.assertIsNone(source['candidate_spotify_id'])
        self.assertIsNone(source['song_id'])
        self.assertEqual(source['match_status'], 'pending')
        self.assertFalse(source['is_recommendation_source'])
        self.assertEqual(category['category'], 'missing_spotify_id')
        self.assertTrue(category['below_one'])
        self.assertEqual(len(scores), 4)
        for score in scores:
            metric = score['insert_values']['metric']
            self.assertEqual(score['insert_values']['raw_value'], before[metric + '_tags'])
            self.assertNotIn('song_source_id', score['insert_values'])
            self.assertNotIn('normalized_value', score['insert_values'])
            self.assertGreaterEqual(D(score['preview']['normalized_value']), -1)
            self.assertLessEqual(D(score['preview']['normalized_value']), 1)

    def test_hash_selection_reproducible_without_source_order_or_score_bias(self):
        rows = [dict(id=str(i), spotify_id='' if i % 2 else 'A' * 22,
                     valence_tags=str(i % 9)) for i in range(100)]
        selected = select_hash_trial(rows, 20, 'fixed-seed')
        ids = {r['id'] for r in selected}
        self.assertEqual(len(ids), 20)
        self.assertEqual(ids, {r['id'] for r in select_hash_trial(list(reversed(rows)), 20, 'fixed-seed')})
        changed = [dict(r, spotify_id='changed', valence_tags='9') for r in rows]
        self.assertEqual(ids, {r['id'] for r in select_hash_trial(changed, 20, 'fixed-seed')})
        self.assertNotEqual(ids, {r['id'] for r in select_hash_trial(rows, 20, 'different-seed')})


if __name__ == '__main__':
    unittest.main()

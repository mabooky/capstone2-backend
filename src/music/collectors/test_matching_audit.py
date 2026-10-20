import unittest
from copy import deepcopy

from matching_audit import assess, candidate_id, duplicate_group

SID = 'A' * 22


def row(i='1', **changes):
    value = dict(id=i, track='Song', artist='Artist', valence_tags='4.50',
                 arousal_tags='5', dominance_tags='6', mbid='', spotify_id=SID)
    value.update(changes)
    return value


def evidence(**changes):
    value = dict(spotify_id=SID, external_id='1', method='independent-recording-review',
                 reference='synthetic-only', reviewer='tester', reviewed_at='2026-10-17',
                 same_recording=True)
    value.update(changes)
    return value


class MatchingAuditTests(unittest.TestCase):
    def test_missing_markers(self):
        for value in ['', ' ', 'NaN', ' null ', 'NONE', 'n/a']:
            self.assertIsNone(candidate_id(value))
        self.assertEqual(candidate_id(' '+SID+' '), SID)

    def test_raw_identical_observations_still_not_selected(self):
        result = duplicate_group(SID, [row(), row('2')])
        self.assertEqual(result['raw_payload_variants_excluding_id'], 1)
        self.assertEqual(result['external_ids'], ['1', '2'])
        self.assertEqual(result['match_status'], 'pending')
        self.assertFalse(result['selected'])

    def test_decimal_equivalence_and_nfkc_reuse(self):
        result = duplicate_group(SID, [row(), row('2', track=' ＳＯＮＧ ', artist='ARTIST', valence_tags='4.5')])
        self.assertEqual(result['metadata_class'], 'same_metadata')
        self.assertEqual(result['vad_variants'], 1)
        self.assertEqual(result['raw_payload_variants_excluding_id'], 2)

    def test_title_artist_and_joint_conflicts(self):
        for changes, expected in [({'track': 'Other'}, 'title_conflict'),
                                  ({'artist': 'Other'}, 'artist_conflict'),
                                  ({'track': 'Other', 'artist': 'Other'}, 'title_and_artist_conflict')]:
            self.assertEqual(duplicate_group(SID, [row(), row('2', **changes)])['metadata_class'], expected)

    def test_version_suffix_is_not_removed(self):
        result = duplicate_group(SID, [row(), row('2', track='Song (Live)')])
        self.assertEqual(result['metadata_class'], 'title_conflict')

    def test_va_and_dominance_conflicts_are_separate(self):
        result = duplicate_group(SID, [row(), row('2', dominance_tags='6.1')])
        self.assertTrue(result['score_conflict'])
        self.assertFalse(result['va_conflict'])
        self.assertTrue(duplicate_group(SID, [row(), row('2', arousal_tags='5.1')])['va_conflict'])

    def test_mbid_missing_is_not_conflict(self):
        self.assertFalse(duplicate_group(SID, [row(), row('2', mbid='x')])['mbid_conflict'])
        self.assertTrue(duplicate_group(SID, [row(mbid='x'), row('2', mbid='y')])['mbid_conflict'])

    def test_source_order_does_not_change_audit(self):
        rows = [row('10'), row('2', valence_tags='3')]
        before = deepcopy(rows)
        self.assertEqual(duplicate_group(SID, rows), duplicate_group(SID, rows[::-1]))
        self.assertEqual(rows, before)

    def test_no_evidence_even_exact_metadata_stays_pending(self):
        result = assess(SID, '1', dict(id_match=True, title_match=True, artist_match=True))
        self.assertEqual(result['decision'], 'hold')
        self.assertFalse(result['eligible_for_reviewed_transition'])

    def test_missing_invalid_or_wrong_case_evidence_holds(self):
        for sid in [None, '', 'A'*21, '!'*22]:
            self.assertEqual(assess(sid, '1', {}, evidence())['decision'], 'hold')
        self.assertEqual(assess(SID.lower(), '1', {'id_match': True}, evidence())['decision'], 'hold')

    def test_group_member_cannot_inherit_other_source_review(self):
        self.assertEqual(assess(SID, '2', {'id_match': True}, evidence())['decision'], 'hold')

    def test_incomplete_or_unconfirmed_identity_holds(self):
        for key in ['method', 'reference', 'reviewer', 'reviewed_at']:
            self.assertEqual(assess(SID, '1', {'id_match': True}, evidence(**{key: ' '}))['decision'], 'hold')
        for observed in [False, None, 1, 'true']:
            self.assertEqual(assess(SID, '1', {'id_match': observed}, evidence())['decision'], 'hold')

    def test_independent_review_can_resolve_text_mismatch_but_never_writes_verified(self):
        result = assess(SID, '1', {'id_match': True, 'title_match': False}, evidence())
        self.assertEqual(result['decision'], 'success')
        self.assertTrue(result['eligible_for_reviewed_transition'])
        self.assertEqual(result['match_status'], 'pending')
        self.assertFalse(result['selected'])

    def test_rejection_needs_explicit_scoped_counterevidence(self):
        self.assertEqual(assess(SID, '1', {'id_match': True, 'title_match': False})['decision'], 'hold')
        result = assess(SID, '1', {}, evidence(same_recording=False))
        self.assertEqual(result['decision'], 'reject')
        self.assertEqual(result['match_status'], 'pending')
        self.assertEqual(assess(SID, '2', {}, evidence(same_recording=False))['decision'], 'hold')


if __name__ == '__main__':
    unittest.main()

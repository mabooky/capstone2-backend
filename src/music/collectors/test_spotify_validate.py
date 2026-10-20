import json
import unittest
from unittest.mock import patch

from spotify_validate import (LookupFailure, SpotifyClient, compare_track, evaluate, select_ids)

SID = 'A' * 22
SECOND = 'B' * 22
ENV = {'SPOTIFY_CLIENT_ID': 'synthetic-client', 'SPOTIFY_CLIENT_SECRET': 'synthetic-secret', 'SPOTIFY_MARKET': 'KR'}


def candidate(sid=SID, refs=None):
    return dict(spotify_id=sid, muse_external_ids=refs or ['1'])


def track(sid=SID, name='Song', artist='Artist'):
    return dict(id=sid, type='track', name=name, artists=[dict(name=artist)])


class FakeNetwork:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.now = 0.0
        self.calls = []

    def send(self, method, url, headers, body):
        self.calls.append((self.now, method, url))
        return next(self.responses)

    def sleep(self, seconds):
        self.now += seconds

    def client(self, env=ENV, **kw):
        return SpotifyClient(env, 'KR', send=self.send, sleep=self.sleep,
            clock=lambda: self.now, wall=lambda: 0, jitter=lambda: 0, **kw)


def token(text='synthetic-token', expires=3600):
    return 200, {}, dict(access_token=text, token_type='Bearer', expires_in=expires)


class SpotifyValidationTests(unittest.TestCase):
    def test_sample_unique_reproducible_and_input_order_independent(self):
        ids = [str(i).zfill(22) for i in range(1000)]
        expected = select_ids(ids)
        self.assertEqual(len(set(expected)), 100)
        self.assertEqual(expected, select_ids(list(reversed(ids)) + ids))
        self.assertNotEqual(expected, select_ids(ids, 'another-seed'))

    def test_missing_auth_and_prepare_mode_make_no_requests(self):
        sample, originals = dict(candidates=[candidate()]), {SID: []}
        with patch('spotify_validate.SpotifyClient', side_effect=AssertionError('No live requests')):
            for env, execute, reason in [({}, True, 'missing_credentials'), (ENV, False, 'execution_not_requested'),
                                        ({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}, True, 'market_not_configured')]:
                rows, stats = evaluate(sample, originals, env, execute)
                self.assertEqual(stats['requests'], 0)
                self.assertEqual(rows[0]['reason'], reason)
                self.assertIsNone(stats['success_rate_among_compared'])

    def test_exact_normalization_and_no_remote_payload_persisted(self):
        original = [dict(external_id='1', title='  ＳＯＮＧ  ', artist=' ARTIST ')]
        result = compare_track(candidate(), original, track())
        self.assertEqual(result['outcome'], 'success')
        self.assertTrue(result['id_exists'])
        self.assertNotIn('Song', json.dumps(result))
        self.assertNotIn('Artist', json.dumps(result))

    def test_title_artist_mismatches_and_versions_remain_distinct(self):
        original = [dict(external_id='1', title='Song', artist='Artist')]
        for body in (track(name='Song - Remastered'), track(artist='Other Artist')):
            result = compare_track(candidate(), original, body)
            self.assertEqual(result['outcome'], 'mismatch')

    def test_all_duplicate_sources_are_compared_without_representative(self):
        originals = [dict(external_id='1', title='Song', artist='Artist'),
                     dict(external_id='2', title='Different', artist='Different')]
        result = compare_track(candidate(refs=['1', '2']), originals, track())
        self.assertEqual(result['outcome'], 'mismatch')
        self.assertEqual(result['reason'], 'ambiguous_source_group')
        self.assertEqual([r['outcome'] for r in result['sources']], ['success', 'mismatch'])

    def test_malformed_relinked_restricted_are_unconfirmed(self):
        originals = [dict(external_id='1', title='Song', artist='Artist')]
        for body in (None, {}, track(sid=SECOND), dict(track(), artists=[]),
                     dict(track(), restrictions={'reason': 'market'}), dict(track(), is_playable=False)):
            self.assertEqual(compare_track(candidate(), originals, body)['outcome'], 'unconfirmed')
        self.assertEqual(compare_track(candidate(), [], track())['reason'], 'source_reference_mismatch')

    def test_successful_client_credentials_and_401_refresh(self):
        network = FakeNetwork([token(), (401, {}, None), token('replacement'), (200, {}, track())])
        self.assertEqual(network.client().track(SID), track())
        self.assertEqual([c[1] for c in network.calls], ['POST', 'GET', 'POST', 'GET'])
        self.assertTrue(all(b[0] - a[0] >= 1 for a, b in zip(network.calls, network.calls[1:])))

    def test_token_expiry_refreshes_before_next_track(self):
        network = FakeNetwork([token(expires=31), (200, {}, track()), token(), (200, {}, track())])
        client = network.client()
        client.track(SID)
        network.now += 32
        client.track(SID)
        self.assertEqual([c[1] for c in network.calls], ['POST', 'GET', 'POST', 'GET'])

    def test_429_retry_after_and_http_date_respected(self):
        for retry in ('10', 'Thu, 01 Jan 1970 00:00:10 GMT'):
            network = FakeNetwork([(429, {'Retry-After': retry}, None), (200, {}, track())])
            client = network.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'})
            client.track(SID)
            self.assertGreaterEqual(network.calls[1][0] - network.calls[0][0], 10)
            self.assertEqual(client.retries, 1)

    def test_long_429_stops_all_ids_without_shortening_server_delay(self):
        network = FakeNetwork([(429, {'Retry-After': '1000'}, None)])
        client = network.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}, wait_budget=20)
        rows, stats = evaluate(dict(candidates=[candidate(), candidate(SECOND)]), {SID: [], SECOND: []},
            ENV, True, client=client)
        self.assertEqual(stats['run_status'], 'halted')
        self.assertEqual(stats['attempted_ids'], 1)
        self.assertEqual(len(network.calls), 1)
        self.assertEqual(stats['unconfirmed'], 2)
        self.assertIn('wait_budget_exhausted', rows[0]['reason'])

    def test_retry_exhausted_429_never_moves_to_next_id(self):
        network = FakeNetwork([(429, {'Retry-After': '2'}, None)] * 2)
        client = network.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}, max_retries=1)
        with self.assertRaises(LookupFailure) as caught:
            client.track(SID)
        self.assertTrue(caught.exception.stop)
        self.assertEqual(len(network.calls), 2)

    def test_network_and_5xx_retry_bounded(self):
        network = FakeNetwork([(0, {}, None), (503, {}, None), (200, {}, track())])
        self.assertEqual(network.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}).track(SID), track())
        exhausted = FakeNetwork([(503, {}, None)] * 4)
        with self.assertRaises(LookupFailure) as caught:
            exhausted.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}).track(SID)
        self.assertEqual(caught.exception.reason, 'server_error_retry_exhausted')
        self.assertEqual(len(exhausted.calls), 4)

    def test_auth_403_and_token_network_failure_stop_run(self):
        for replies in ([token(), (403, {}, None)], [(503, {}, None)] * 4):
            network = FakeNetwork(replies)
            rows, stats = evaluate(dict(candidates=[candidate(), candidate(SECOND)]), {SID: [], SECOND: []},
                ENV, True, client=network.client())
            self.assertEqual(stats['attempted_ids'], 1)
            self.assertEqual(stats['run_status'], 'halted')
            saved = json.dumps(dict(rows=rows, stats=stats))
            for secret in ('synthetic-client', 'synthetic-secret', 'synthetic-token'):
                self.assertNotIn(secret, saved)

    def test_404_is_unknown_in_context_and_next_id_is_checked(self):
        network = FakeNetwork([(404, {}, None), (200, {}, track(SECOND))])
        originals = {sid: [dict(external_id='1', title='Song', artist='Artist')] for sid in (SID, SECOND)}
        rows, stats = evaluate(dict(candidates=[candidate(), candidate(SECOND)]), originals, ENV, True,
            client=network.client({'SPOTIFY_ACCESS_TOKEN': 'synthetic-token'}))
        self.assertEqual(rows[0]['outcome'], 'unconfirmed')
        self.assertIsNone(rows[0]['id_exists'])
        self.assertEqual(stats['attempted_ids'], 2)
        self.assertEqual(stats['success_rate_among_compared'], 1)
        self.assertEqual(stats['success_rate_among_attempted'], .5)


if __name__ == '__main__':
    unittest.main()

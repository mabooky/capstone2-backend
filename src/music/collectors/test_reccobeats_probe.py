import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from decimal import Decimal
import subprocess

from reccobeats_probe import compare_metadata, feature_summary, items, memory_records, powershell_transport, probe, spotify_id

SID = 'A' * 22
SID2 = 'B' * 22
UUID = '00000000-0000-4000-8000-000000000001'


def candidate(sid=SID):
    return dict(spotify_id=sid, muse_external_ids=['1'])


def track(sid=SID):
    return dict(id=UUID, href='https://open.spotify.com/track/' + sid,
        trackTitle='Synthetic title', artists=[dict(name='Synthetic artist')])


def features(sid=SID, **kw):
    return dict(id=UUID, href='https://open.spotify.com/track/' + sid,
        energy=Decimal('.718371'), valence=Decimal('.381237'), **kw)


class ReccobeatsProbeTests(unittest.TestCase):
    def test_payload_envelopes_and_strict_spotify_href(self):
        self.assertEqual(items({'content': []}), [])
        self.assertIsNone(items({'error': 'bad'}))
        self.assertEqual(spotify_id('https://open.spotify.com/track/' + SID + '?si=123'), SID)
        self.assertIsNone(spotify_id('https://fake.invalid/track/' + SID))
        self.assertIsNone(spotify_id('https://open.spotify.com/artist/' + SID))

    def test_duplicate_metadata_sources_all_compared(self):
        originals = [dict(external_id='1', title='  ＳＹＮＴＨＥＴＩＣ title ', artist='SYNTHETIC artist'),
                     dict(external_id='2', title='Other version', artist='Other artist')]
        result = compare_metadata(track(), originals)
        self.assertFalse(result['all_source_metadata_match'])
        self.assertTrue(result['sources'][0]['title_match'])
        self.assertFalse(result['sources'][1]['artist_match'])
        self.assertNotIn('Synthetic', json.dumps(result))

    def test_feature_presence_range_and_no_values_saved(self):
        summary = feature_summary({'energy': .718371, 'valence': .381237, 'tempo': 125})
        self.assertTrue(summary['energy_valid'] and summary['valence_valid'])
        for raw in (None, True, float('nan'), -1, 1.1, '.5'):
            self.assertFalse(feature_summary({'energy': raw})['energy_valid'])
        saved = json.dumps(summary)
        for raw in ('.718371', '.381237', '125'):
            self.assertNotIn(raw, saved)

    def test_preparation_makes_no_calls_and_limits_song_count(self):
        def reject(*args):
            raise AssertionError('No requests expected')
        _, stats = probe(dict(candidates=[candidate()]), {}, send=reject)
        self.assertEqual(stats['request_count'], 0)
        self.assertIsNone(stats['id_match_rate'])
        with self.assertRaises(ValueError):
            probe(dict(candidates=[candidate()] * 11), {}, send=reject)

    def test_403_means_unmeasured_not_catalog_miss(self):
        rows, stats = probe(dict(candidates=[candidate(), candidate(SID2)]), {}, execute=True,
            send=lambda *args: (403, {}, None))
        self.assertEqual(stats['request_count'], 1)
        self.assertIsNone(stats['id_match_rate'])
        self.assertFalse(stats['catalog_lookup_observed'])
        self.assertIsNone(stats['returned_track_count'])
        self.assertTrue(all(row['lookup_outcome'] == 'lookup_http_403' for row in rows))

    def test_live_shape_with_features_stops_on_429_and_never_persists_payload(self):
        responses = iter([(200, {}, {'content': [track(), track(SID2)]}),
                          (429, {'Retry-After': '100'}, None)])
        times = [0.0]
        calls = []
        def send(method, url, headers, body):
            self.assertNotIn('Authorization', headers)
            calls.append(times[0])
            return next(responses)
        originals = {sid: [dict(external_id='1', title='Synthetic title', artist='Synthetic artist')]
                     for sid in (SID, SID2)}
        rows, stats = probe(dict(candidates=[candidate(), candidate(SID2)]), originals, True,
            send=send, sleep=lambda seconds: times.__setitem__(0, times[0] + seconds), clock=lambda: times[0])
        self.assertEqual(len(calls), 2)
        self.assertGreaterEqual(calls[1] - calls[0], 2)
        self.assertEqual(stats['features_attempted'], 1)
        self.assertEqual(rows[1]['feature_outcome'], 'run_halted')
        self.assertNotIn('Synthetic', json.dumps(dict(rows=rows, stats=stats)))

    def test_success_and_empty_catalog_response(self):
        originals = {SID: [dict(external_id='1', title='Synthetic title', artist='Synthetic artist')]}
        responses = iter([(200, {}, {'content': [track()]}), (200, {}, features())])
        _, stats = probe(dict(candidates=[candidate()]), originals, True,
            send=lambda *args: next(responses), sleep=lambda seconds: None)
        self.assertEqual(stats['eligible_a_candidates'], 1)
        self.assertEqual(stats['eligible_c_candidates'], 1)
        self.assertEqual(stats['actual_verified_or_db_loaded'], 0)
        _, empty = probe(dict(candidates=[candidate()]), originals, True,
            send=lambda *args: (200, {}, {'content': []}))
        self.assertEqual(empty['id_match_rate'], 0)
        self.assertEqual(empty['returned_track_count'], 0)
        self.assertEqual(empty['feature_outcomes'], {'not_attempted': 1})

    def test_lookup_only_reports_return_count_and_never_requests_features(self):
        calls = []
        def send(*args):
            calls.append(args)
            self.assertEqual(len(calls), 1)
            return 200, {}, {'content': [track()]}
        originals = {SID: [dict(external_id='1', title='Synthetic title', artist='Synthetic artist')]}
        rows, stats = probe(dict(candidates=[candidate(), candidate(SID2)]), originals, True,
            send=send, lookup_only=True)
        self.assertEqual(stats['metadata_http_status'], 200)
        self.assertEqual(stats['returned_track_count'], 1)
        self.assertEqual(stats['id_matches'], 1)
        self.assertEqual(stats['id_match_rate'], .5)
        self.assertEqual(stats['request_count'], 1)
        self.assertEqual(stats['features_attempted'], 0)
        self.assertEqual(rows[0]['feature_outcome'], 'skipped_lookup_only')
        self.assertEqual(rows[1]['lookup_outcome'], 'not_returned')

    def test_feature_limit_keeps_remaining_matches_without_extra_calls(self):
        replies = iter([(200, {}, {'content': [track(), track(SID2)]}), (200, {}, features())])
        originals = {sid: [dict(external_id='1', title='Synthetic title', artist='Synthetic artist')] for sid in (SID, SID2)}
        rows, stats = probe(dict(candidates=[candidate(), candidate(SID2)]), originals, True,
            send=lambda *args: next(replies), sleep=lambda seconds: None, feature_limit=1)
        self.assertEqual(stats['id_matches'], 2)
        self.assertEqual(stats['features_attempted'], 1)
        self.assertEqual(stats['request_count'], 2)
        self.assertEqual(rows[1]['feature_outcome'], 'skipped_feature_limit')

    def test_powershell_bridge_uses_memory_pipe_and_fixed_host(self):
        response = SimpleNamespace(returncode=0, stdout=json.dumps({'status':200,'headers':{},'payload':{'content':[]}}))
        with patch('reccobeats_probe.subprocess.run', return_value=response) as run:
            self.assertEqual(powershell_transport('GET','https://api.reccobeats.com/v1/track?ids='+SID,{},None),
                             (200,{}, {'content':[]}))
            self.assertTrue(run.call_args.kwargs['capture_output'])
            self.assertNotIn('shell', run.call_args.kwargs)
            self.assertNotIn(SID, str(run.call_args.args))
        for url in ('http://api.reccobeats.com/v1/track', 'https://other.invalid/v1/track'):
            with self.assertRaises(ValueError):
                powershell_transport('GET',url,{},None)

    def test_decimal_precision_and_malformed_json_keep_http_status(self):
        for body in ('{"energy":0.718371123456789123456789}', '{bad-json'):
            response = SimpleNamespace(returncode=0, stdout=json.dumps({'status':200,'headers':{},'payload_json':body}))
            with patch('reccobeats_probe.subprocess.run', return_value=response):
                status, _, payload = powershell_transport('GET','https://api.reccobeats.com/v1/track',{},None)
            self.assertEqual(status, 200)
            if body.startswith('{"'):
                self.assertEqual(payload['energy'], Decimal('0.718371123456789123456789'))
            else:
                self.assertIsNone(payload)

    def test_bridge_timeout_and_invalid_envelope_are_static_errors(self):
        with patch('reccobeats_probe.subprocess.run', side_effect=subprocess.TimeoutExpired('powershell',30)):
            self.assertEqual(powershell_transport('GET','https://api.reccobeats.com/v1/track',{},None),(0,{},None))
        with patch('reccobeats_probe.subprocess.run', return_value=SimpleNamespace(returncode=0,stdout='[]')):
            self.assertEqual(powershell_transport('GET','https://api.reccobeats.com/v1/track',{},None),(0,{},None))

    def test_memory_sql_contract_shape_bounds_pending_and_generated_column(self):
        source, scores = memory_records(track(),candidate(),features(),'2026-10-17T00:00:00+00:00')
        expected = ['song_id','provider','external_id','source_version','fetched_at','source_url',
            'rights_reference','raw_payload','candidate_spotify_id','match_status','match_evidence',
            'verified_at','is_recommendation_source']
        self.assertEqual(set(source),set(expected))
        self.assertIsNone(source['song_id'])
        self.assertEqual(source['match_status'],'pending')
        self.assertFalse(source['is_recommendation_source'])
        self.assertEqual(len(scores),2)
        for row in scores:
            self.assertEqual(set(row['insert_values']),{'metric','raw_value','normalization_version'})
            self.assertIsInstance(row['insert_values']['raw_value'],str)
            self.assertEqual(row['insert_values']['normalization_version'],'reccobeats-v1')
            self.assertEqual(Decimal(row['preview']['normalized_value']),2*Decimal(row['insert_values']['raw_value'])-1)
        broken=features(); broken['energy']=None
        _, partial=memory_records(track(),candidate(),broken,'2026-10-17T00:00:00+00:00')
        self.assertEqual([s['insert_values']['metric'] for s in partial],['valence'])

    def test_mismatched_feature_identity_never_qualifies_for_views(self):
        responses=iter([(200,{}, {'content':[track()]}),(200,{}, features(SID2))])
        originals={SID:[dict(external_id='1',title='Synthetic title',artist='Synthetic artist')]}
        rows,stats=probe(dict(candidates=[candidate()]),originals,True,
            send=lambda *args:next(responses),sleep=lambda seconds:None)
        self.assertEqual(rows[0]['feature_outcome'],'feature_identity_unconfirmed')
        self.assertEqual(stats['sql_contract_sources'],0)
        self.assertEqual(stats['eligible_a_candidates'],0)
        self.assertEqual(stats['eligible_c_candidates'],0)
        self.assertNotIn('.718371',json.dumps({'rows':rows,'stats':stats}))


if __name__ == '__main__':
    unittest.main()

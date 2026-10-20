import json
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from clean_muse import LOCAL
from reccobeats_batch import (Checkpoint, Engine, SimulatedClock, SyntheticProvider,
                             live_transport, retry_after)


def groups(n=25):
    return {str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(n)}


class BatchTests(unittest.TestCase):
    def setUp(self):
        parent = LOCAL/'reccobeats-batch'
        parent.mkdir(exist_ok=True,parents=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)/'checkpoint'
        self.groups = groups()
        self.clock = SimulatedClock()
        self.provider = SyntheticProvider(self.groups)
        self.calls = []

    def cp(self, conflicts=None, manifest=None):
        return Checkpoint(self.path,self.groups,conflicts or {},manifest or {'test':'fixture'})

    def send(self, method, url, headers, data):
        self.calls.append((self.clock(),url))
        return self.provider(method,url,headers,data)

    def engine(self, cp, send=None):
        return Engine(cp,send or self.send,self.clock,self.clock.sleep)

    def test_boundary_resume_completed_jobs_never_replayed(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(5),'interrupted_at_boundary')
        with self.cp() as cp:
            engine = self.engine(cp)
            self.assertEqual(engine.run(),'completed')
            self.assertEqual(engine.summary('done')['simulated_requests'],28)
            self.assertEqual(engine.run(),'completed')
        self.assertEqual(len(self.calls),28)
        self.assertEqual(len({url for _,url in self.calls}),28)
        self.assertTrue(all(b[0]-a[0]>=2 for a,b in zip(self.calls,self.calls[1:])))

    def test_os_lock_and_population_fingerprint(self):
        with self.cp():
            with self.assertRaises(RuntimeError):
                with self.cp(): pass
        self.groups[next(iter(self.groups))][0]['title']='Changed'
        with self.assertRaises(ValueError):
            with self.cp(): pass

    def test_changed_manifest_rejected(self):
        with self.cp(): pass
        with self.assertRaises(ValueError):
            with self.cp(manifest={'test':'changed'}): pass

    def test_live_transport_and_engine_default_are_locked(self):
        with patch('reccobeats_batch.powershell_transport',side_effect=AssertionError('No network')):
            with self.assertRaises(PermissionError): live_transport()
            with self.cp() as cp:
                with self.assertRaises(PermissionError): Engine(cp).run()
                self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],0)

    def test_403_requires_explicit_operator_retry(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(403,{},None)).run(),'operator_review_required')
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'operator_review_required')
            cp.retry_job('metadata:000000')
            self.assertEqual(self.engine(cp).run(),'completed')

    def test_429_persisted_global_retry_after_across_resume(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(429,{'retry-after':'120'},None)).run(1),'interrupted_at_boundary')
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'completed')
        self.assertGreaterEqual(self.calls[0][0],120)

    def test_retry_after_http_date_and_invalid_fallback(self):
        self.assertEqual(retry_after({'Retry-After':'Thu, 01 Jan 1970 00:02:00 GMT'},0),120)
        self.assertEqual(retry_after({'Retry-After':'invalid'},0),60)
        self.assertEqual(retry_after({'Retry-After':'NaN'},0),60)
        self.assertEqual(retry_after({'Retry-After':'7200'},0),7200)

    def test_5xx_bounded_and_failure_not_auto_replayed(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(503,{},None)).run(),'metadata_failures_require_review')
            self.assertEqual(cp.db.execute('SELECT max(attempts) FROM jobs').fetchone()[0],3)
            count=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'metadata_failures_require_review')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],count)
            with self.assertRaises(ValueError): cp.retry_job('metadata:000000')

    def test_transient_network_error_then_success(self):
        first=[True]
        def send(*args):
            if first.pop() if first else False: raise TimeoutError()
            return self.send(*args)
        with self.cp() as cp:
            engine=self.engine(cp,send)
            self.assertEqual(engine.run(),'completed')
            self.assertEqual(engine.summary('done')['retry_attempts'],1)

    def test_inflight_crash_is_uncertain_not_duplicate(self):
        def crash(*args):
            self.send(*args)
            raise KeyboardInterrupt()
        with self.cp() as cp:
            with self.assertRaises(KeyboardInterrupt): self.engine(cp,crash).run()
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'operator_review_required')
            self.assertEqual(len(self.calls),1)
            with self.assertRaises(ValueError): cp.retry_job('metadata:000000')
            cp.retry_job('metadata:000000',acknowledge_possible_duplicate=True)
            self.assertEqual(self.engine(cp).run(),'completed')

    def test_metadata_missing_and_duplicate_response_do_not_get_features(self):
        def send(*args):
            status,headers,payload=self.send(*args)
            if 'content' in payload:
                payload['content']=payload['content'][1:]
                if payload['content']: payload['content'].append(payload['content'][0])
            return status,headers,payload
        with self.cp() as cp:
            engine=self.engine(cp,send)
            self.assertEqual(engine.run(),'completed')
            self.assertEqual(engine.summary('done')['feature_jobs'],19)

    def test_duplicate_and_text_conflict_quarantined(self):
        sid=next(iter(self.groups))
        self.groups[sid].append(dict(external_id='duplicate',title='Other',artist='Artist'))
        def send(*args):
            status,headers,payload=self.send(*args)
            if 'content' in payload: payload['content'][-1]['trackTitle']='Wrong'
            return status,headers,payload
        with self.cp({sid:{'metadata_class':'title_conflict'}}) as cp:
            engine=self.engine(cp,send)
            self.assertEqual(engine.run(),'completed')
            result=engine.summary('done')
            self.assertEqual(result['held_duplicates'],1)
            self.assertEqual(result['held_metadata'],3)
            self.assertEqual(result['actual_verified'],0)

    def test_uuid_collision_quarantines_both_ids(self):
        def send(*args):
            status,headers,payload=self.send(*args)
            if 'content' in payload and len(payload['content'])>1:
                payload['content'][1]['id']=payload['content'][0]['id']
            return status,headers,payload
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM candidates WHERE collision=1').fetchone()[0],6)
            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE stage='features'").fetchone()[0],19)

    def test_wrong_feature_identity_fails_without_values(self):
        def send(*args):
            status,headers,payload=self.send(*args)
            if 'valence' in payload: payload['href']='https://open.spotify.com/track/'+'Z'*22
            return status,headers,payload
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed_with_failures')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM candidates WHERE feature_outcome IS NOT NULL').fetchone()[0],0)

    def test_partial_and_invalid_features_do_not_zero_fill(self):
        def send(*args):
            status,headers,payload=self.send(*args)
            if 'energy' in payload: payload['energy']=None
            return status,headers,payload
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed')
            self.assertEqual(cp.db.execute("SELECT count(*) FROM candidates WHERE feature_outcome='partial_features'").fetchone()[0],25)
        # Persisted checkpoint has no numeric scores, raw metadata or model fields.
        import sqlite3
        with closing(sqlite3.connect(self.path/'checkpoint.sqlite')) as db:
            dump='\n'.join(db.iterdump())
        for marker in ['0.25','0.75','raw_value','trackTitle','Song','Artist']:
            self.assertNotIn(marker,dump)

    def test_malformed_metadata_fails_and_no_feature_stage(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(200,{},None)).run(),'metadata_failures_require_review')
            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE stage='features'").fetchone()[0],0)

    def test_terminal_404_not_retried(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(404,{},None)).run(),'metadata_failures_require_review')
            self.assertEqual(cp.db.execute('SELECT max(attempts) FROM jobs').fetchone()[0],1)

    def test_global_retry_budget_is_enforced(self):
        def send(*args):
            if '/audio-features' in args[1]: return 500,{},None
            return self.send(*args)
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'request_budget_exhausted')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],30)


if __name__ == '__main__':
    unittest.main()

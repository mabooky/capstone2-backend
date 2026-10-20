import json
import tempfile
import unittest
from pathlib import Path

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, SyntheticProvider
from reccobeats_research import (MODE, EXPANDED_MODE, ResearchCheckpoint, ResearchEngine, ResearchTransport, report, seed_completed, verify_expansion)


class ResearchTests(unittest.TestCase):
    def setUp(self):
        parent=LOCAL/'reccobeats-research'
        parent.mkdir(exist_ok=True,parents=True)
        self.temp=tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'checkpoint'
        self.groups={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(100)}
        self.manifest={'mode':MODE,'fixture':True}
        self.clock=SimulatedClock()
        self.provider=SyntheticProvider(self.groups)

    def cp(self):
        return ResearchCheckpoint(self.path,self.groups,{},self.manifest)

    def engine(self,cp,send=None):
        return ResearchEngine(cp,ResearchTransport(cp,execute=True,send=send or self.provider),
                              clock=self.clock,sleep=self.clock.sleep)

    def test_exact_100_scope_and_explicit_activation(self):
        with self.cp() as cp:
            with self.assertRaises(PermissionError): ResearchTransport(cp)
        self.groups['extra']=[dict(external_id='extra',title='Song',artist='Artist')]
        with self.assertRaises(ValueError):
            with self.cp(): pass

    def test_score_and_job_atomic_resume_no_duplicate_requests(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(11),'interrupted_at_boundary')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM research_features').fetchone()[0],1)
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'completed')
            before=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
            self.assertEqual(self.engine(cp).run(),'completed')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],before)
            result=report(cp,'completed')
            self.assertEqual(result['coordinate_pairs'],100)
            self.assertEqual(result['requests_dispatched'],110)
            self.assertEqual(result['exact_id_matches'],100)
            self.assertEqual(result['actual_verified'],0)
            starts=[r[0] for r in cp.db.execute('SELECT started FROM attempts ORDER BY started')]
            self.assertTrue(all(b-a>=3 for a,b in zip(starts,starts[1:])))
            self.assertEqual(result['normalized_valence']['mean'],-0.5)
            self.assertEqual(result['normalized_arousal']['mean'],0.5)
            self.assertEqual(result['quadrants']['-+'],100)

    def test_403_is_sticky_and_not_manually_retried(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:(403,{},None)).run(),'operator_review_required')
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'operator_review_required')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],1)
            with self.assertRaises(PermissionError): cp.retry_job('metadata:000000')
            result=report(cp,'blocked')
            self.assertEqual(result['metadata_attempted_ids'],10)
            self.assertEqual(result['metadata_observed_ids'],0)
            self.assertIsNone(result['exact_id_match_rate_among_observed'])

    def test_429_retry_after_and_strict_mismatch_hold(self):
        first=[True]
        def send(*args):
            if first:
                first.pop()
                return 429,{'Retry-After':'120'},None
            status,headers,payload=self.provider(*args)
            if 'content' in payload: payload['content'][0]['trackTitle']='Other recording'
            return status,headers,payload
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed')
            result=report(cp,'completed')
            self.assertEqual(result['strict_metadata_matches'],90)
            self.assertEqual(result['coordinate_pairs'],90)
            self.assertEqual(result['title_mismatch_sources'],10)
            self.assertGreaterEqual(cp.db.execute('SELECT min(started) FROM attempts WHERE attempt=2').fetchone()[0],120)

    def test_invalid_feature_rolls_back_value_and_keeps_failure(self):
        def send(*args):
            status,headers,payload=self.provider(*args)
            if 'valence' in payload: payload['id']='wrong-uuid'
            return status,headers,payload
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed_with_failures')
            self.assertEqual(cp.db.execute('SELECT count(*) FROM research_features').fetchone()[0],0)
            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE stage='features' AND state='failed'").fetchone()[0],100)

    def test_transport_blocks_unreserved_or_external_requests(self):
        with self.cp() as cp:
            transport=ResearchTransport(cp,execute=True,send=lambda *a: (_ for _ in ()).throw(AssertionError('No request')))
            for url in ['https://example.org/v1/track','https://api.reccobeats.com/v1/track?ids=outside']:
                with self.assertRaises(PermissionError): transport('GET',url,{},None)

    def test_expansion_import_resume_and_no_completed_id_replay(self):
        with self.cp() as cp:
            self.assertEqual(self.engine(cp).run(),'completed')
        expanded={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(1000)}
        target=self.path.parent/'expanded'
        manifest={'mode':EXPANDED_MODE,'fixture':True}
        provider=SyntheticProvider(expanded)
        requested=[]
        def send(method,url,*rest):
            if '/audio-features' not in url:
                from urllib.parse import parse_qs,urlparse
                ids=parse_qs(urlparse(url).query)['ids'][0].split(',')
                self.assertFalse(set(ids)&set(self.groups))
                requested.extend(ids)
            return provider(method,url,*rest)
        with ResearchCheckpoint(target,expanded,{},manifest) as cp:
            with self.assertRaises(PermissionError): ResearchTransport(cp,execute=True)
            seed_completed(cp,self.path)
            self.assertEqual(cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0],110)
            self.assertEqual(self.engine(cp,send).run(1),'interrupted_at_boundary')
        with ResearchCheckpoint(target,expanded,{},manifest) as cp:
            seed_completed(cp,self.path)
            self.assertEqual(self.engine(cp,send).run(),'completed')
            before=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
            self.assertEqual(self.engine(cp,send).run(),'completed')
            self.assertEqual(before,1100)
            self.assertEqual(len(requested),900)
            self.assertEqual(len(set(requested)),900)
            result=report(cp,'completed')
            self.assertEqual(result['coordinate_pairs'],1000)
            self.assertEqual(result['expansion_requests'],990)
            self.assertEqual(cp.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(verify_expansion(cp,self.path)['result'],'PASS')
            cp.db.execute("UPDATE research_features SET normalized_valence='0' WHERE sid=?",(next(iter(expanded)),))
            self.assertEqual(verify_expansion(cp,self.path)['result'],'FAIL')

    def test_incomplete_original_cannot_be_used_to_bypass_stop(self):
        with self.cp() as cp:
            self.engine(cp,lambda *a:(403,{},None)).run()
        expanded={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(1000)}
        with ResearchCheckpoint(self.path.parent/'expanded',expanded,{},dict(mode=EXPANDED_MODE)) as cp:
            with self.assertRaises(ValueError): seed_completed(cp,self.path)
            with self.assertRaises(PermissionError): ResearchTransport(cp,execute=True)


if __name__=='__main__':
    unittest.main()

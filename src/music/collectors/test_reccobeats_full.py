import json
import tempfile
import unittest
from pathlib import Path

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, SyntheticProvider
from reccobeats_full import SIZES, full_population
from reccobeats_research import ResearchCheckpoint, ResearchEngine, ResearchTransport, valid_scope
from reccobeats_tenthousand import cohort_population, run_cohort


class FullExpansionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=LOCAL)
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        self.groups={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')]
                     for i in range(11000)}
        self.manifest={'source_sha256':'fixture'}
        self.clock=SimulatedClock(2000000000)

    def source(self):
        groups,conflicts,manifest=cohort_population(self.groups,{},self.manifest,10000)
        root=self.path/'source'
        with ResearchCheckpoint(root,groups,conflicts,manifest) as cp:
            # Offline source fixture: every metadata response is a completed miss.
            with cp.db: cp.put('reused_previous',json.dumps({'ids':9000,'requests':0}))
            engine=ResearchEngine(cp,ResearchTransport(cp,execute=True,send=lambda *a:(200,{},dict(content=[]))),
                                  clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(engine.run(),'completed')
        return root

    def target(self):
        return full_population(self.groups,{},self.manifest,11000)

    def test_new_scope_boundaries_and_old_entry_stays_bounded(self):
        self.assertEqual(SIZES[-2:],(60000,60741))
        for size in (10000,11001,60742):
            with self.assertRaises(ValueError): full_population(self.groups,{},self.manifest,size)
        with self.assertRaises(ValueError): cohort_population(self.groups,{},self.manifest,11000)
        groups,conflicts,manifest=self.target()
        self.assertTrue(valid_scope(ResearchCheckpoint(self.path/'valid',groups,conflicts,manifest)))
        manifest['mode']='temporary-research-fixed-11000-v1'
        with self.assertRaises(ValueError):
            with ResearchCheckpoint(self.path/'bad',groups,conflicts,manifest): pass

    def test_terminal_741_scope_is_explicit(self):
        from types import SimpleNamespace
        groups=dict.fromkeys(range(60741))
        self.assertTrue(valid_scope(SimpleNamespace(groups=groups,
            manifest={'mode':'temporary-research-full-60741-v1'})))
        self.assertFalse(valid_scope(SimpleNamespace(groups=groups,
            manifest={'mode':'temporary-research-fixed-60741-v1'})))

    def test_full_entry_resumes_429_and_never_replays_completed_misses(self):
        source=self.source()
        groups,conflicts,manifest=self.target()
        first=[True]; sent=[]
        def send(method,url,*args):
            if first:
                first.pop(); return 429,{'Retry-After':'121'},None
            sent.append(url)
            return 200,{},dict(content=[])
        path=self.path/'expanded'
        with ResearchCheckpoint(path,groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=send,clock=self.clock,sleep=self.clock.sleep,
                              max_requests=1,chunk_requests=2000)
            self.assertEqual(result['request_attempts'],1001)
            due=float(cp.get('not_before'))
        with ResearchCheckpoint(path,groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=send,clock=self.clock,sleep=self.clock.sleep,chunk_requests=2000)
            self.assertEqual(result['outcome'],'completed')
            self.assertGreaterEqual(cp.db.execute('SELECT min(started) FROM attempts WHERE attempt=2').fetchone()[0],due)
            self.assertEqual(len(sent),100)
            before=result['request_attempts']
            result=run_cohort(cp,source,send=lambda *a:self.fail('Completed requests replayed'),
                              clock=self.clock,sleep=self.clock.sleep,chunk_requests=2000)
            self.assertEqual(result['request_attempts'],before)

    def test_full_403_is_sticky(self):
        source=self.source()
        with ResearchCheckpoint(self.path/'expanded',*self.target()) as cp:
            result=run_cohort(cp,source,send=lambda *a:(403,{},None),clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['outcome'],'operator_review_required')
            result=run_cohort(cp,source,send=lambda *a:self.fail('403 replay'),clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['request_attempts'],1001)

    def test_full_5xx_is_limited_and_blocks_next_cohort(self):
        source=self.source()
        with ResearchCheckpoint(self.path/'expanded',*self.target()) as cp:
            result=run_cohort(cp,source,send=lambda *a:(503,{},None),clock=self.clock,sleep=self.clock.sleep,
                              chunk_requests=2000)
            self.assertEqual(result['outcome'],'metadata_failures_require_review')
            self.assertEqual(cp.db.execute('SELECT max(attempts) FROM jobs').fetchone()[0],3)

    def test_batched_partial_resume_and_next_cohort_preserve_lineage(self):
        self.groups.update({str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')]
                            for i in range(11000,12000)})
        source=self.source()
        provider=SyntheticProvider(self.groups)
        path=self.path/'expanded'
        with ResearchCheckpoint(path,*self.target()) as cp:
            result=run_cohort(cp,source,send=provider,clock=self.clock,sleep=self.clock.sleep,
                max_requests=101,feature_batch_size=40)
            self.assertEqual(result['coordinate_pairs'],40)
        with ResearchCheckpoint(path,*self.target()) as cp:
            result=run_cohort(cp,source,send=provider,clock=self.clock,sleep=self.clock.sleep,
                feature_batch_size=40)
            self.assertEqual(result['outcome'],'completed')
            self.assertEqual(result['feature_batch_requests'],25)
            self.assertEqual(result['request_attempts'],1125)
        groups,conflicts,manifest=full_population(self.groups,{},self.manifest,12000)
        with ResearchCheckpoint(self.path/'next',groups,conflicts,manifest) as cp:
            result=run_cohort(cp,path,send=provider,clock=self.clock,sleep=self.clock.sleep,
                feature_batch_size=40)
            self.assertEqual(result['outcome'],'completed')
            self.assertEqual(result['coordinate_pairs'],2000)
            self.assertEqual(result['request_attempts'],1250)


if __name__=='__main__': unittest.main()

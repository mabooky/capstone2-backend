import json
import tempfile
import unittest
from pathlib import Path
from urllib.parse import parse_qs,urlparse

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock,SyntheticProvider
from reccobeats_research import (EXPANDED_MODE,ResearchCheckpoint,ResearchEngine,
    ResearchTransport,verify_expansion)
from reccobeats_tenthousand import cohort_population,run_cohort,estimate


class ExpansionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=LOCAL/'reccobeats-research')
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        self.groups={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(2000)}
        self.clock=SimulatedClock()

    def source(self):
        selected,_,_=cohort_population(self.groups,{},dict(source_sha256='fixture'),2000)
        from spotify_validate import select_ids
        groups={sid:selected[sid] for sid in select_ids(selected,count=1000)}
        source=self.path/'source'
        with ResearchCheckpoint(source,groups,{},dict(mode=EXPANDED_MODE,source_sha256='fixture')) as cp:
            # Synthetic fixture only: no network transport, no original research data.
            with cp.db: cp.put('reused_100',json.dumps(dict(ids=100,requests=0)))
            engine=ResearchEngine(cp,ResearchTransport(cp,execute=True,send=SyntheticProvider(groups)),
                                  clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(engine.run(),'completed')
        return source,groups

    def test_resume_429_lineage_and_completed_requests_never_replayed(self):
        source,old=self.source()
        groups,conflicts,manifest=cohort_population(self.groups,{},dict(source_sha256='fixture'),2000)
        path=self.path/'expanded'
        provider=SyntheticProvider(groups)
        seen=[]; first=[True]
        def send(method,url,*args):
            if first:
                first.pop()
                return 429,{'Retry-After':'61'},None
            if '/audio-features' not in url:
                ids=parse_qs(urlparse(url).query)['ids'][0].split(',')
                self.assertFalse(set(ids)&set(old)); seen.extend(ids)
            return provider(method,url,*args)
        with ResearchCheckpoint(path,groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=send,clock=self.clock,sleep=self.clock.sleep,max_requests=1)
            self.assertEqual(result['outcome'],'interrupted_at_boundary')
            retry_at=float(cp.get('not_before'))
        with ResearchCheckpoint(path,groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=send,clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['outcome'],'completed')
            self.assertEqual(result['coordinate_pairs'],2000)
            self.assertEqual(result['requests_dispatched'],2201)
            self.assertGreaterEqual(cp.db.execute('SELECT min(started) FROM attempts WHERE attempt=2').fetchone()[0],retry_at)
            self.assertEqual(verify_expansion(cp,source)['result'],'PASS')
            before=result['requests_dispatched']
            result=run_cohort(cp,source,send=send,clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['requests_dispatched'],before)
            self.assertEqual(len(seen),len(set(seen)))
            self.assertEqual(len(seen),1000)
            self.assertTrue(estimate(result)['based_on_completed_scope'])

    def test_403_stop_is_preserved_on_resume(self):
        source,_=self.source()
        groups,conflicts,manifest=cohort_population(self.groups,{},dict(source_sha256='fixture'),2000)
        with ResearchCheckpoint(self.path/'expanded',groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=lambda *args:(403,{},None),clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['outcome'],'operator_review_required')
        with ResearchCheckpoint(self.path/'expanded',groups,conflicts,manifest) as cp:
            result=run_cohort(cp,source,send=lambda *args: self.fail('No request after 403'),clock=self.clock,sleep=self.clock.sleep)
            self.assertEqual(result['requests_dispatched'],1101)

    def test_hard_scope_boundaries(self):
        for size in (0,1000,10001,11000,2500):
            with self.assertRaises(ValueError): cohort_population(self.groups,{},dict(),size)


if __name__=='__main__': unittest.main()

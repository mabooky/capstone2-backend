"""Offline identity, retry and resume tests; no live transport is permitted."""
import json
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, SyntheticProvider
from reccobeats_full import graceful_interrupt
from reccobeats_multifeature import MultiFeatureEngine
from reccobeats_research import MODE, ResearchCheckpoint, ResearchEngine, ResearchTransport


class MultiFeatureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=LOCAL)
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        self.groups={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(100)}
        self.clock=SimulatedClock(2000000000)
        self.provider=SyntheticProvider(self.groups)
        for target in ('reccobeats_research.powershell_transport','socket.socket','subprocess.run'):
            guard=patch(target,side_effect=AssertionError('Network/external process forbidden'))
            guard.start(); self.addCleanup(guard.stop)

    def cp(self):
        return ResearchCheckpoint(self.path,self.groups,{},dict(mode=MODE,fixture='multi-v1'))

    def engine(self, cp, send=None, **kwargs):
        return MultiFeatureEngine(cp,ResearchTransport(cp,execute=True,send=send or self.provider),
            clock=self.clock,sleep=self.clock.sleep,**kwargs)

    def ready(self,cp):
        engine=ResearchEngine(cp,ResearchTransport(cp,execute=True,send=self.provider),
            clock=self.clock,sleep=self.clock.sleep)
        self.assertEqual(engine.run(10),'interrupted_at_boundary')

    def count(self,cp,table):
        return cp.db.execute('SELECT count(*) FROM '+table).fetchone()[0]

    def assert_integrity(self,cp):
        self.assertEqual(cp.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
        self.assertFalse(cp.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_reordered_response_40_limit_resume_and_zero_replay(self):
        urls=[]
        def send(*args):
            urls.append(args[1])
            status,headers,payload=self.provider(*args)
            for item in payload['content']:
                item['valence']=int(item['href'].split('/')[-1])/100
            return status,headers,payload
        with self.cp() as cp:
            self.ready(cp)
            original=cp.get('manifest')
            self.assertEqual(self.engine(cp,send).run(1),'interrupted_at_boundary')
            self.assertEqual(self.count(cp,'research_features'),40)
            self.assertEqual(cp.get('manifest'),original)
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,send).run(),'completed')
            self.assertEqual(self.count(cp,'research_features'),100)
            self.assertEqual(cp.db.execute('SELECT valence FROM research_features WHERE sid=?',
                (str(17).zfill(22),)).fetchone()[0],'0.17')
            self.assertEqual(self.count(cp,'attempts'),13)
            self.assertEqual([len(parse_qs(urlparse(u).query)['ids'][0].split(',')) for u in urls],[40,40,20])
            self.assertTrue(all(urlparse(u).path=='/v1/audio-features' for u in urls))
            self.assertEqual(self.engine(cp,lambda *a:self.fail('Replay')).run(),'completed')
            self.assertEqual(self.count(cp,'attempts'),13)
            self.assert_integrity(cp)

    def test_partial_or_empty_response_is_terminal_hold_without_fallback(self):
        for empty in (False,True):
            with self.subTest(empty=empty), self.cp() as cp:
                self.ready(cp) if cp.get('features_planned') is None else None
                def send(*args):
                    status,headers,p=self.provider(*args)
                    p['content']=[] if empty else p['content'][1:]
                    return status,headers,p
                self.engine(cp,send).run(1)
                self.assertTrue(cp.db.execute("SELECT 1 FROM candidates WHERE feature_outcome='held_batch_missing'").fetchone())
                self.assert_integrity(cp)
        with self.cp() as cp:
            self.engine(cp).run()
            self.assertEqual(self.engine(cp,lambda *a:self.fail('Held replay')).run(),'completed')

    def test_duplicate_foreign_wrong_href_and_bad_envelope_fail_atomically(self):
        for kind in ('duplicate','foreign','href','envelope','bad_score','bad_item'):
            with self.subTest(kind=kind):
                with tempfile.TemporaryDirectory(dir=LOCAL) as d:
                    old=self.path; self.path=Path(d)
                    try:
                        with self.cp() as cp:
                            self.ready(cp)
                            def send(*args):
                                status,headers,p=self.provider(*args)
                                if kind=='duplicate': p['content'].append(p['content'][0])
                                elif kind=='foreign': p['content'][0]['id']='foreign'
                                elif kind=='href': p['content'][0]['href']='https://open.spotify.com/track/wrong'
                                elif kind=='envelope': p={'content':{}}
                                elif kind=='bad_item': p['content'].append(None)
                                else: p['content'][0].update(valence=True,energy=float('nan'))
                                return status,headers,p
                            self.engine(cp,send).run(1)
                            self.assertEqual(self.count(cp,'research_features'),0)
                            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE state='failed'").fetchone()[0],1)
                            self.assert_integrity(cp)
                    finally: self.path=old

    def test_429_deadline_survives_reopen_and_only_parent_retries(self):
        with self.cp() as cp:
            self.ready(cp)
            self.engine(cp,lambda *a:(429,{'Retry-After':'120'},None)).run(1)
            due=float(cp.get('not_before'))
        with self.cp() as cp:
            self.engine(cp).run(1)
            retry=cp.db.execute('SELECT started FROM attempts WHERE attempt=2').fetchone()[0]
            self.assertGreaterEqual(retry,due)
            self.assertEqual(self.count(cp,'research_features'),40)
            self.assertEqual(cp.db.execute("SELECT sum(attempts) FROM jobs WHERE state='batched'").fetchone()[0] or 0,0)

    def test_5xx_retry_limit_404_review_and_sticky_403(self):
        for status in (503,404,403):
            with self.subTest(status=status), tempfile.TemporaryDirectory(dir=LOCAL) as d:
                old=self.path; self.path=Path(d)
                try:
                    with self.cp() as cp:
                        self.ready(cp)
                        outcome=self.engine(cp,lambda *a:(status,{},None)).run()
                        self.assertEqual(outcome,'operator_review_required' if status==403 else 'completed_with_failures')
                        self.assertEqual(cp.db.execute('SELECT max(attempts) FROM jobs').fetchone()[0],3 if status==503 else 1)
                        self.assertEqual(self.count(cp,'research_features'),0)
                        self.assertFalse(cp.db.execute("SELECT 1 FROM candidates WHERE feature_outcome='not_found'").fetchone())
                        if status==403:
                            self.assertEqual(self.engine(cp,lambda *a:self.fail('403 replay')).run(),'operator_review_required')
                            key=cp.db.execute("SELECT key FROM jobs WHERE state='blocked'").fetchone()[0]
                            with self.assertRaises(PermissionError): cp.retry_job(key)
                finally: self.path=old

    def test_ctrl_c_finishes_batch_and_hard_interrupt_becomes_uncertain(self):
        with graceful_interrupt() as stop:
            with self.cp() as cp:
                self.ready(cp)
                def send(*args):
                    signal.raise_signal(signal.SIGINT)
                    return self.provider(*args)
                self.assertEqual(self.engine(cp,send,stop_requested=stop).run(),'interrupted_by_user')
                self.assertEqual(self.count(cp,'research_features'),40)
        with self.cp() as cp:
            def crash(*args): raise KeyboardInterrupt()
            with self.assertRaises(KeyboardInterrupt): self.engine(cp,crash).run()
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,lambda *a:self.fail('Uncertain replay')).run(),'operator_review_required')
            self.assertEqual(self.count(cp,'research_features'),40)
            self.assert_integrity(cp)

    def test_existing_attempted_single_job_is_never_regrouped(self):
        with self.cp() as cp:
            self.ready(cp)
            old=ResearchEngine(cp,ResearchTransport(cp,execute=True,send=lambda *a:(503,{},None)),
                clock=self.clock,sleep=self.clock.sleep)
            old.run(1)
            urls=[]
            def send(*args): urls.append(args[1]); return self.provider(*args)
            self.engine(cp,send).run()
            self.assertEqual(sum('/track/' in u for u in urls),1)
            self.assertEqual(self.count(cp,'research_features'),100)

    def test_unattempted_batch_resumes_after_reservation_and_size_switch(self):
        with self.cp() as cp:
            self.ready(cp)
            engine=self.engine(cp)
            # Plan legacy jobs, then group without dispatch (crash boundary).
            engine.run(1)
            parent=engine.next_feature_job()
            self.assertEqual(parent['attempts'],0)
        with self.cp() as cp:
            self.assertEqual(self.engine(cp,feature_batch_size=1).run(),'completed')
            self.assertEqual(self.count(cp,'research_features'),100)

    def test_transport_rejects_changed_uuid_query_or_completed_candidate(self):
        with self.cp() as cp:
            self.ready(cp)
            engine=self.engine(cp)
            def tamper(method,url,*args):
                transport=ResearchTransport(cp,execute=True,send=lambda *a:self.fail('Invalid dispatch'))
                with self.assertRaises(PermissionError): transport(method,url.replace('ids=','ids=foreign%2C'),*args)
                return self.provider(method,url,*args)
            self.engine(cp,tamper).run(1)
            self.assertEqual(self.count(cp,'research_features'),40)

    def test_tail_one_uses_batch_endpoint_and_keeps_strict_holds(self):
        with self.cp() as cp:
            self.ready(cp)
            sid=min(self.groups)
            with cp.db:
                cp.db.execute("UPDATE candidates SET feature_outcome='held_metadata' WHERE sid<>?",(sid,))
            urls=[]
            def send(*args): urls.append(args[1]); return self.provider(*args)
            self.assertEqual(self.engine(cp,send).run(),'completed')
            self.assertEqual(len(urls),1)
            self.assertEqual(urlparse(urls[0]).path,'/v1/audio-features')
            self.assertEqual(self.count(cp,'research_features'),1)
            self.assertEqual(cp.db.execute("SELECT count(*) FROM candidates WHERE feature_outcome='held_metadata'").fetchone()[0],99)

    def test_failed_parent_retry_never_replays_other_completed_batches(self):
        first=[True]
        with self.cp() as cp:
            self.ready(cp)
            def send(*args):
                if first:
                    first.pop(); return 400,{},None
                return self.provider(*args)
            self.assertEqual(self.engine(cp,send).run(),'completed_with_failures')
            self.assertEqual(self.count(cp,'research_features'),60)
            parent=cp.db.execute("SELECT key FROM jobs WHERE state='failed'").fetchone()[0]
            member=cp.db.execute("SELECT key FROM jobs WHERE state='batched' LIMIT 1").fetchone()[0]
            with self.assertRaises(PermissionError): cp.retry_job(member)
            cp.retry_job(parent)
            self.assertEqual(self.engine(cp).run(),'completed')
            self.assertEqual(self.count(cp,'research_features'),100)
            self.assert_integrity(cp)


if __name__=='__main__': unittest.main()

"""Offline terminal-feature-404 classification; other failures remain failures."""
import tempfile
import unittest
from pathlib import Path

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, SyntheticProvider
from reccobeats_research import MODE, ResearchCheckpoint, ResearchEngine, ResearchTransport, resolve_feature_404


class FeatureAbsenceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=LOCAL)
        self.addCleanup(self.temp.cleanup)
        self.groups={str(i).zfill(22):[dict(external_id=str(i),title='Song',artist='Artist')] for i in range(100)}
        self.cp=ResearchCheckpoint(Path(self.temp.name),self.groups,{},dict(mode=MODE,fixture='feature-404'))
        self.clock=SimulatedClock()
        self.provider=SyntheticProvider(self.groups)

    def engine(self,cp,send):
        return ResearchEngine(cp,ResearchTransport(cp,execute=True,send=send),clock=self.clock,sleep=self.clock.sleep)

    def one_missing(self,cp):
        self.assertEqual(self.engine(cp,self.provider).run(10),'interrupted_at_boundary')
        self.assertEqual(self.engine(cp,lambda *a:(404,{},None)).run(1),'interrupted_at_boundary')
        return cp.db.execute("SELECT * FROM jobs WHERE stage='features' AND last_status=404").fetchone()

    def test_new_feature_404_is_terminal_without_fabricated_scores_or_retry(self):
        with self.cp as cp:
            missing=self.one_missing(cp)
            self.assertEqual((missing['state'],missing['reason']),('done','feature_not_found'))
            self.assertEqual(cp.db.execute("SELECT count(*) FROM candidates WHERE feature_outcome='not_found'").fetchone()[0],1)
            self.assertEqual(cp.db.execute('SELECT count(*) FROM research_features').fetchone()[0],0)
            self.assertEqual(self.engine(cp,self.provider).run(),'completed')
            self.assertEqual(cp.db.execute('SELECT attempts FROM jobs WHERE key=?',(missing['key'],)).fetchone()[0],1)
            self.assertEqual(self.engine(cp,lambda *a:self.fail('Completed replay')).run(),'completed')

    def test_legacy_failure_reclassification_keeps_all_observations_and_is_idempotent(self):
        with self.cp as cp:
            missing=self.one_missing(cp)
            with cp.db:
                cp.db.execute("UPDATE jobs SET state='failed',reason='http_other' WHERE key=?",(missing['key'],))
                cp.db.execute("UPDATE candidates SET feature_outcome=NULL WHERE feature_outcome='not_found'")
                cp.db.execute("UPDATE attempts SET reason='http_other' WHERE status=404")
            before={t:[tuple(r) for r in cp.db.execute('SELECT * FROM '+t)]
                    for t in ('attempts','research_calls','research_features')}
            self.assertEqual(resolve_feature_404(cp),1)
            self.assertEqual(resolve_feature_404(cp),0)
            for table,rows in before.items():
                self.assertEqual([tuple(r) for r in cp.db.execute('SELECT * FROM '+table)],rows)
            self.assertEqual(cp.db.execute("SELECT count(*) FROM events WHERE kind='feature_404_classified'").fetchone()[0],1)
            self.assertEqual(self.engine(cp,self.provider).run(),'completed')
            self.assertEqual(cp.db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertFalse(cp.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_metadata_404_and_unresolved_5xx_are_not_accepted(self):
        with self.cp as cp:
            self.assertEqual(self.engine(cp,lambda *a:(404,{},None)).run(),'metadata_failures_require_review')
            self.assertEqual(resolve_feature_404(cp),0)
            self.assertEqual(cp.db.execute("SELECT count(*) FROM jobs WHERE state='failed'").fetchone()[0],10)

    def test_legacy_404_requires_valid_mapping_and_recorded_response(self):
        with self.cp as cp:
            missing=self.one_missing(cp)
            with cp.db:
                cp.db.execute("UPDATE jobs SET state='failed',reason='http_other' WHERE key=?",(missing['key'],))
                cp.db.execute("UPDATE candidates SET feature_outcome=NULL,uuid='invalid' WHERE feature_outcome='not_found'")
            self.assertEqual(resolve_feature_404(cp),0)
            self.assertEqual(cp.db.execute("SELECT state FROM jobs WHERE key=?",(missing['key'],)).fetchone()[0],'failed')


if __name__=='__main__': unittest.main()

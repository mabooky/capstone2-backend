"""Offline-only audit: copy stopped checkpoints, inject synthetic responses, retain evidence.

Run with --output-dir pointing to a NEW directory under music/.local. No collector
entry point, real transport, source lock, or source database write is used.
"""
import argparse
import hashlib
import json
import math
import sqlite3
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, population
from reccobeats_full import LIVE_ROOT
from reccobeats_research import ResearchCheckpoint, ResearchTransport, verify_expansion
from reccobeats_tenthousand import run_cohort


def readonly(path):
    # immutable avoids creating WAL/SHM alongside protected files. Refuse an
    # outstanding WAL rather than accidentally ignoring uncheckpointed data.
    wal=path.with_name(path.name+'-wal')
    if wal.exists() and wal.stat().st_size:
        raise ValueError('Source WAL exists; use a separately authorized consistent snapshot')
    db=sqlite3.connect(path.resolve().as_uri()+'?mode=ro&immutable=1',uri=True)
    db.row_factory=sqlite3.Row
    return db


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def verify(output):
    output=output.resolve()
    if not output.is_relative_to(LOCAL.resolve()):
        raise ValueError('Output must be a new music/.local subdirectory')
    output.mkdir(parents=True,exist_ok=False)
    originals=[LIVE_ROOT/f'fixed-{n}-v1'/'checkpoint.sqlite' for n in (27000,28000)]
    before={str(p):digest(p) for p in originals}
    for path in originals:
        target=output/path.parent.name
        target.mkdir()
        src=readonly(path)
        dst=sqlite3.connect(target/'checkpoint.sqlite')
        try: src.backup(dst)
        finally: dst.close(); src.close()
    source=output/'fixed-27000-v1'
    target=output/'fixed-28000-v1'
    db=readonly(originals[1])
    try:
        manifest=json.loads(db.execute("SELECT value FROM meta WHERE key='manifest'").fetchone()[0])
        ids={r[0] for r in db.execute('SELECT sid FROM candidates')}
        pending=[r[0] for r in db.execute("SELECT sid FROM candidates WHERE feature_outcome IS NULL AND uuid IS NOT NULL AND collision=0 AND metadata_outcome='matched_href'")]
        old_features=[tuple(r) for r in db.execute('SELECT * FROM research_features ORDER BY sid')]
        old_attempts=[tuple(r) for r in db.execute('SELECT * FROM attempts ORDER BY job_key,attempt')]
        old_calls=[tuple(r) for r in db.execute('SELECT * FROM research_calls ORDER BY job_key,attempt')]
        done_jobs=[tuple(r) for r in db.execute("SELECT * FROM jobs WHERE state='done' ORDER BY key")]
        old_candidates=[tuple(r) for r in db.execute('SELECT * FROM candidates ORDER BY sid') if r['sid'] not in pending]
        by_uuid={r['uuid']:r['sid'] for r in db.execute('SELECT sid,uuid FROM candidates WHERE uuid IS NOT NULL')}
    finally: db.close()
    groups,conflicts,_=population()
    groups={sid:groups[sid] for sid in ids}
    conflicts={sid:value for sid,value in conflicts.items() if sid in ids}
    sent=[]
    clock=SimulatedClock(2100000000)
    def send(method,url,headers,data):
        parsed=urlparse(url)
        if method!='GET' or parsed.path!='/v1/audio-features':
            raise AssertionError('No metadata or individual feature requery allowed')
        internal=parse_qs(parsed.query)['ids'][0].split(',')
        sids=[by_uuid[u] for u in internal]
        if not 1<=len(sids)<=40 or not set(sids)<=set(pending) or set(sids)&set(sent):
            raise AssertionError('Completed/foreign/duplicate candidate dispatched')
        sent.extend(sids)
        return 200,{},dict(content=[dict(id=u,href='https://open.spotify.com/track/'+by_uuid[u],
            valence=0.25,energy=0.75) for u in reversed(internal)])
    def checkpoint(): return ResearchCheckpoint(target,groups,conflicts,manifest)
    with patch('reccobeats_research.powershell_transport',side_effect=AssertionError('Live forbidden')), \
         patch('socket.socket',side_effect=AssertionError('Network forbidden')), \
         patch('subprocess.run',side_effect=AssertionError('External process forbidden')):
        with checkpoint() as cp:
            with cp.db: cp.put('offline_synthetic_validation','true')
            first=run_cohort(cp,source,send=send,clock=clock,sleep=clock.sleep,
                max_requests=1,feature_batch_size=40)
            assert first['outcome']=='interrupted_at_boundary'
        with checkpoint() as cp:
            result=run_cohort(cp,source,send=send,clock=clock,sleep=clock.sleep,feature_batch_size=40)
            assert result['outcome']=='completed'
            for table,rows,keys in [('research_features',old_features,('sid',)),
                    ('attempts',old_attempts,('job_key','attempt')),('research_calls',old_calls,('job_key','attempt')),
                    ('jobs',done_jobs,('key',)),('candidates',old_candidates,('sid',))]:
                columns=[r[1] for r in cp.db.execute('PRAGMA table_info('+table+')')]
                positions=[columns.index(k) for k in keys]
                for row in rows:
                    actual=cp.db.execute('SELECT * FROM '+table+' WHERE '+' AND '.join(k+'=?' for k in keys),
                        tuple(row[i] for i in positions)).fetchone()
                    assert actual is not None and tuple(actual)==row,table+' original row changed'
            attempts=result['request_attempts']
            replay=run_cohort(cp,source,send=lambda *a: (_ for _ in ()).throw(AssertionError('Completed replay')),
                clock=clock,sleep=clock.sleep,feature_batch_size=40)
            assert replay['request_attempts']==attempts
            assert verify_expansion(cp,source)['result']=='PASS'
            assert cp.get('manifest')==json.dumps(manifest,sort_keys=True)
            assert set(sent)==set(pending)
            batch_requests=result['feature_batch_requests']
            assert batch_requests==math.ceil(len(pending)/40)
            with_error=False
            try: ResearchTransport(cp,execute=True)
            except PermissionError: with_error=True
            assert with_error,'Validation copy must never use live transport'
    after={str(p):digest(p) for p in originals}
    assert before==after,'Protected source checkpoint changed'
    report=dict(result='PASS',actual_api_calls=0,synthetic_copy_only=True,
        original_pairs_preserved=len(old_features),original_attempts_preserved=len(old_attempts),
        original_calls_preserved=len(old_calls),completed_jobs_preserved=len(done_jobs),
        pending_ids=len(pending),single_requests=len(pending),batch_requests=batch_requests,
        resumed_after_one_request=True,completed_replay_requests=0,lineage_integrity='PASS',
        protected_source_sha256=before,manifest_unchanged=True,
        note='Copied results contain synthetic values; never use for collection lineage or coverage.')
    (output/'verification.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,required=True)
    print(json.dumps(verify(parser.parse_args().output_dir),ensure_ascii=False))


if __name__=='__main__': main()

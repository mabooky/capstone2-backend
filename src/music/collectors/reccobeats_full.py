"""Prepare/resume the remaining MuSe IDs. Default modes never contact an API."""
import argparse
import hashlib
import json
import math
import sqlite3
import signal
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from clean_muse import LOCAL
from reccobeats_batch import SimulatedClock, SyntheticProvider, exclusive_lock, population
from reccobeats_research import INTERVAL, ResearchCheckpoint, report, seed_completed, verify_expansion
from reccobeats_tenthousand import atomic_json, run_cohort
from spotify_validate import SEED, select_ids

TOTAL = 60741
SOURCE = LOCAL/'reccobeats-research/fixed-10000-v1'
PREPARATION = LOCAL/'reccobeats-full-preparation'
LIVE_ROOT = LOCAL/'reccobeats-full-v1'
DRY_ROOT = LOCAL/'reccobeats-full-dry-v1'
SIZES = (*range(11000,60001,1000),TOTAL)


@contextmanager
def graceful_interrupt():
    """Finish the reserved request/transaction; repeated Ctrl+C never tears it down."""
    stopped=[False]
    def request_stop(signum,frame):
        stopped[0]=True
    previous=signal.signal(signal.SIGINT,request_stop)
    try:
        yield lambda:stopped[0]
    finally:
        signal.signal(signal.SIGINT,previous)


def read_checkpoint(path):
    db=sqlite3.connect((path/'checkpoint.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
    db.row_factory=sqlite3.Row
    return db


def audit_source(groups, conflicts, manifest):
    """Read-only evidence, independent of the saved summary's completion claims."""
    db=read_checkpoint(SOURCE)
    try:
        saved=json.loads(db.execute("SELECT value FROM meta WHERE key='manifest'").fetchone()[0])
        rows=db.execute('SELECT * FROM candidates').fetchall()
        selected={sid:groups[sid] for sid in select_ids(groups,count=10000)}
        proxy=SimpleNamespace(db=db,groups=selected)
        audit=verify_expansion(proxy,SOURCE.parent/'fixed-9000-v1')
        count=lambda sql:db.execute(sql).fetchone()[0]
        pairs=count('SELECT count(*) FROM research_features f JOIN candidates c USING(sid) '
                    'WHERE valence IS NOT NULL AND energy IS NOT NULL AND c.collision=0 '
                    "AND c.feature_outcome='both_available'")
        checks=dict(audit['checks'],
            source_manifest=saved['source_sha256']==manifest['source_sha256'],
            source_mode=saved['mode']=='temporary-research-fixed-10000-v1',
            unique_ids=len(rows)==len({r['sid'] for r in rows})==10000,
            reproducible_selection={r['sid'] for r in rows}==set(selected),
            source_references=all(json.loads(r['refs'])==sorted(x['external_id'] for x in groups[r['sid']])
                and json.loads(r['conflict'])==conflicts.get(r['sid']) for r in rows),
            complete=count("SELECT count(*) FROM jobs WHERE state!='done'")==0,
            observed=count('SELECT count(*) FROM candidates WHERE metadata_outcome IS NOT NULL')==10000,
            no_unresolved_attempts=count('SELECT count(*) FROM attempts WHERE status IS NULL')==0,
            valid_pairs=pairs==count('SELECT count(*) FROM research_features')==4540,
            inherited_retries=count('SELECT count(*) FROM attempts WHERE attempt>1')==2)
        result=dict(result='PASS' if all(checks.values()) else 'FAIL',checks=checks,
            unique_ids=len(rows),coordinate_pairs=pairs,requests=count('SELECT count(*) FROM attempts'),
            completed_jobs=count("SELECT count(*) FROM jobs WHERE state='done'"))
        if result['result']!='PASS': raise ValueError('10,000-ID checkpoint audit failed: '+json.dumps(checks))
        return result
    finally:
        db.close()


def prepare(groups, conflicts, manifest):
    audit=audit_source(groups,conflicts,manifest)
    ordered=select_ids(groups,count=TOTAL)
    remaining=ordered[10000:]
    reused=set(ordered[:10000])
    if (len(remaining)!=50741 or len(set(remaining))!=50741 or reused&set(remaining)
            or reused|set(remaining)!=set(groups)):
        raise ValueError('Additional cohort is not an exact disjoint population complement')
    encoded=('\n'.join(remaining)+'\n').encode()
    metadata=math.ceil(len(remaining)/10)
    features=round(len(remaining)*audit['coordinate_pairs']/10000)
    upper=metadata+len(remaining)
    result=dict(source_audit=audit,source_sha256=manifest['source_sha256'],seed=SEED,
        selection='SHA256(UTF8(seed + NUL + Spotify ID)), ID tie-break; ranks 10001..60741',
        population_ids=TOTAL,reused_ids=10000,additional_ids=len(remaining),
        disjoint_complement=True,
        additional_ids_sha256=hashlib.sha256(encoded).hexdigest(),
        metadata_requests=metadata,estimated_feature_requests=features,
        estimated_requests=metadata+features,maximum_requests_without_retries=upper,
        planning_retry_allowance=math.ceil(upper*.05),
        estimated_spacing_hours=(metadata+features-1)*INTERVAL/3600,
        maximum_spacing_hours=(upper-1)*INTERVAL/3600,
        note='Conditional 45.40% feature rate; 3s start spacing. Latency, local audits, retries, '
             '429, outages and pauses add time; this is not provider quota or permission.',
        actual_api_calls=0)
    PREPARATION.mkdir(parents=True,exist_ok=True)
    (PREPARATION/'additional-spotify-ids.txt').write_bytes(encoded)
    atomic_json(PREPARATION/'preparation.json',result)
    return result


def full_population(groups,conflicts,manifest,size):
    if size not in SIZES: raise ValueError('Invalid full expansion milestone')
    selected={sid:groups[sid] for sid in select_ids(groups,count=size)}
    return selected,{sid:conflicts[sid] for sid in selected if sid in conflicts},dict(manifest,
        mode=f'temporary-research-full-{size}-v1',unique_ids=size,
        sample={'selection':'same SHA256 seed order as original 100/1000/10000','seed':SEED},
        scope='noncommercial university research; cumulative maximum 60741; local only',
        provider_storage_reuse_permission='unconfirmed',research_interval=INTERVAL,
        retention='Delete all research data/checkpoints/exports/backups after December 2026 project end; short-term storage is subject to terms')


def execute(groups,conflicts,manifest,*,dry_run,max_requests=None,stop_requested=None,feature_batch_size=40):
    root=DRY_ROOT if dry_run else LIVE_ROOT
    root.mkdir(parents=True,exist_ok=True)
    with exclusive_lock(root/'runner.lock'):
        source=SOURCE
        milestones_path=root/'milestones.json'
        milestones=json.loads(milestones_path.read_text()) if milestones_path.exists() else []
        remaining=max_requests
        for size in SIZES:
            selected,subset,config=full_population(groups,conflicts,manifest,size)
            # Separate manifests prevent synthetic observations from becoming live lineage.
            config['execution']='synthetic-offline' if dry_run else 'research-live'
            path=root/f'fixed-{size}-v1'
            with ResearchCheckpoint(path,selected,subset,config) as cp:
                seed_completed(cp,source)
                clock=SimulatedClock(max(float(cp.get('simulated_now','0')),
                                         float(cp.get('not_before','0')))) if dry_run else None
                provider=SyntheticProvider(selected) if dry_run else None
                before=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
                def progress(result):
                    result.update(cumulative_limit=TOTAL,resume_directory=str(path),
                                  execution=config['execution'],actual_api_calls=0 if dry_run else None)
                    atomic_json(root/'progress.json',result)
                kwargs=dict(send=provider,max_requests=remaining,on_progress=progress,
                            chunk_requests=2000 if dry_run else 20,stop_requested=stop_requested,
                            feature_batch_size=feature_batch_size)
                if dry_run: kwargs.update(clock=clock,sleep=clock.sleep)
                try:
                    result=run_cohort(cp,source,**kwargs)
                except (KeyboardInterrupt,Exception) as error:
                    result=report(cp,'interrupted' if isinstance(error,KeyboardInterrupt) else 'execution_error')
                    result['exception_type']=type(error).__name__
                    progress(result)
                    raise
                used=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]-before
                if remaining is not None: remaining-=used
                if result['outcome']!='completed': return result
                if stop_requested is not None and stop_requested():
                    result['outcome']='interrupted_by_user'
                    progress(result)
                    return result
                milestones=[r for r in milestones if r['selected_ids']!=size]+[result]
                milestones.sort(key=lambda r:r['selected_ids'])
                atomic_json(milestones_path,milestones)
                print(json.dumps({k:result[k] for k in ('selected_ids','outcome','coordinate_pairs','expansion_requests')}),flush=True)
                if dry_run:
                    attempts=result['request_attempts']
                    replay=run_cohort(cp,source,send=lambda *a: (_ for _ in ()).throw(
                        AssertionError('Completed request replayed')),clock=clock,sleep=clock.sleep,chunk_requests=2000,
                        feature_batch_size=feature_batch_size)
                    if replay['request_attempts']!=attempts: raise AssertionError('Duplicate request')
                    atomic_json(path/'replay-verification.json',dict(result='PASS',additional_requests=0))
            source=path
            if remaining==0: return result
        return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--prepare',action='store_true')
    mode.add_argument('--dry-run',action='store_true')
    mode.add_argument('--research-live',action='store_true')
    mode.add_argument('--report-only',action='store_true')
    parser.add_argument('--max-requests',type=int)
    parser.add_argument('--feature-batch-size',type=int,choices=(1,40),default=40)
    args=parser.parse_args()
    if args.max_requests is not None and (args.max_requests<1 or not (args.dry_run or args.research_live)):
        parser.error('max-requests requires a run mode and positive integer')
    if args.report_only:
        path=LIVE_ROOT/'progress.json'
        print(path.read_text(encoding='utf-8') if path.exists() else '{"outcome":"not_started"}')
        return
    groups,conflicts,manifest=population()
    preparation=prepare(groups,conflicts,manifest)
    if args.prepare:
        print(json.dumps(preparation)); return
    with graceful_interrupt() as stop_requested:
        if args.dry_run:
            # Fail closed even if a future refactor accidentally chooses a real transport.
            with patch('reccobeats_research.powershell_transport',side_effect=AssertionError('Network forbidden')), \
                 patch('socket.socket',side_effect=AssertionError('Network forbidden')), \
                 patch('subprocess.run',side_effect=AssertionError('External process forbidden')):
                result=execute(groups,conflicts,manifest,dry_run=True,max_requests=args.max_requests,stop_requested=stop_requested,
                               feature_batch_size=args.feature_batch_size)
        else:
            result=execute(groups,conflicts,manifest,dry_run=False,max_requests=args.max_requests,stop_requested=stop_requested,
                           feature_batch_size=args.feature_batch_size)
    print(json.dumps({k:result[k] for k in ('outcome','selected_ids','coordinate_pairs','request_attempts')}))


if __name__=='__main__': main()

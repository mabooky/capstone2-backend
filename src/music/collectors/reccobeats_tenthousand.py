"""Explicit research expansion: reuse 1000 IDs, stop at cumulative 10000 IDs."""
import argparse
import json
import math
import os
import time
from datetime import datetime, timezone

from reccobeats_batch import exclusive_lock, population
from reccobeats_research import (EXPANDED_ROOT, INTERVAL, ResearchCheckpoint, ResearchEngine,
    ResearchTransport, report, resolve_feature_404, seed_completed, verify_expansion)
from spotify_validate import select_ids

LIMIT=10000
RUN_ROOT=EXPANDED_ROOT.parent/'expansion-10000-v1'


def atomic_json(path, value):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,indent=2)+'\n',encoding='utf-8')
    os.replace(temp,path)


def cohort_population(groups,conflicts,manifest,size):
    if size not in range(2000,LIMIT+1,1000):
        raise ValueError('Only cumulative 2000..10000 in 1000-ID steps')
    selected={sid:groups[sid] for sid in select_ids(groups,count=size)}
    config=dict(manifest,mode=f'temporary-research-fixed-{size}-v1',unique_ids=size,
        sample={'selection':'same SHA256 seed order as original 100/1000','seed':'muse-spotify-unique-100-v1'},
        scope='noncommercial university research; cumulative maximum 10000; local only',
        provider_storage_reuse_permission='unconfirmed',research_interval=INTERVAL,
        retention='Delete all research data/checkpoints/exports/backups after December 2026 project end; short-term storage is subject to terms')
    return selected,{sid:conflicts[sid] for sid in selected if sid in conflicts},config


def estimate(result):
    """Conditional point estimates; filtered coverage, not verified songs or provider permission."""
    n=result['metadata_observed_ids']
    if not n: return None
    rate=result['coordinate_pairs']/n
    # Strict metadata may still lack completed features while a cohort is running.
    complete=result['outcome']=='completed'
    requests=math.ceil(60741/10)+60741*rate
    retries=result['retries']/result['request_attempts'] if result['request_attempts'] else 0
    pace=result['expansion_start_intervals']['mean'] or INTERVAL
    return dict(based_on_completed_scope=complete,observed_ids=n,
        qualified_coordinate_rate=rate,estimated_qualified_tracks=round(60741*rate),
        estimated_requests_including_observed_retries=math.ceil(requests/(1-retries)),
        estimated_total_active_hours=requests/(1-retries)*pace/3600,
        note='Conditional sample-rate extrapolation; only completed scopes usable. No verified promotion; quotas/outages/collisions/metadata differences can change coverage and time.')


def run_cohort(cp,source,*,send=None,clock=time.time,sleep=time.sleep,max_requests=None,on_progress=None,chunk_requests=20,stop_requested=None,feature_batch_size=1):
    from reccobeats_multifeature import MultiFeatureEngine
    seed_completed(cp,source)
    if cp.manifest.get('mode','').startswith('temporary-research-full-'):
        resolve_feature_404(cp)
    audit=verify_expansion(cp,source)
    if audit['result']!='PASS': raise ValueError('Preflight lineage audit failed')
    engine=MultiFeatureEngine(cp,ResearchTransport(cp,execute=True,send=send),clock=clock,sleep=sleep,
                          stop_requested=stop_requested,feature_batch_size=feature_batch_size)
    remaining=max_requests
    while True:
        start=time.monotonic()
        budget=chunk_requests if remaining is None else min(chunk_requests,remaining)
        before=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
        outcome=engine.run(budget)
        used=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]-before
        with cp.db:
            cp.put('active_seconds',float(cp.get('active_seconds','0'))+time.monotonic()-start)
        result=report(cp,outcome)
        result['cohort_active_seconds']=float(cp.get('active_seconds','0'))
        # Preserve the historical single-track estimate as an explicitly named
        # baseline. Actual batch attempts remain visible separately in report().
        result['full_population_estimate']=estimate(result)
        if result['full_population_estimate'] is not None:
            result['full_population_estimate']['request_model']='single-track baseline; excludes batch savings'
        result['feature_batch_size']=feature_batch_size
        atomic_json(cp.directory/'summary.json',result)
        if on_progress: on_progress(result)
        if remaining is not None: remaining-=used
        if outcome!='interrupted_at_boundary' or remaining==0:
            audit=verify_expansion(cp,source)
            atomic_json(cp.directory/'verification.json',audit)
            if audit['result']!='PASS': raise ValueError('Postflight lineage audit failed')
            return result


def execute(*,report_only=False,max_requests=None):
    RUN_ROOT.mkdir(parents=True,exist_ok=True)
    with exclusive_lock(RUN_ROOT/'runner.lock'):
        if report_only:
            path=RUN_ROOT/'progress.json'
            return json.loads((path if path.exists() else EXPANDED_ROOT/'summary.json').read_text(encoding='utf-8'))
        groups,conflicts,manifest=population()
        source=EXPANDED_ROOT
        initial=json.loads((source/'summary.json').read_text(encoding='utf-8'))
        if initial['outcome']!='completed' or initial['selected_ids']!=1000:
            raise ValueError('Original 1000-ID experiment must be completed')
        milestones_path=RUN_ROOT/'milestones.json'
        milestones=json.loads(milestones_path.read_text(encoding='utf-8')) if milestones_path.exists() else [initial]
        atomic_json(milestones_path,milestones)
        latest=initial
        remaining=max_requests
        for size in range(2000,LIMIT+1,1000):
            root=source.parent/f'fixed-{size}-v1'
            selected,subset,config=cohort_population(groups,conflicts,manifest,size)
            with ResearchCheckpoint(root,selected,subset,config) as cp:
                seed_completed(cp,source)
                def progress(result):
                    result['recorded_at']=datetime.now(timezone.utc).isoformat()
                    result['cumulative_limit']=LIMIT
                    result['resume_directory']=str(root)
                    atomic_json(RUN_ROOT/'progress.json',result)
                before=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]
                try:
                    latest=run_cohort(cp,source,max_requests=remaining,on_progress=progress)
                except (KeyboardInterrupt,Exception) as error:
                    latest=report(cp,'interrupted' if isinstance(error,KeyboardInterrupt) else 'execution_error')
                    latest['exception_type']=type(error).__name__
                    progress(latest)
                    raise
                used=cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]-before
                if remaining is not None: remaining-=used
                if latest['outcome']!='completed': return latest
                milestones=[m for m in milestones if m['selected_ids']!=size]+[latest]
                milestones.sort(key=lambda m:m['selected_ids'])
                atomic_json(milestones_path,milestones)
                print(json.dumps({k:latest[k] for k in ('selected_ids','outcome','metadata_observed_ids',
                    'exact_id_matches','coordinate_pairs','expansion_requests','cohort_active_seconds','http_statuses')}),flush=True)
            source=root
            if remaining==0: return latest
        return latest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--research-live',action='store_true',required=True)
    parser.add_argument('--report-only',action='store_true')
    parser.add_argument('--max-requests',type=int)
    args=parser.parse_args()
    if args.max_requests is not None and args.max_requests<1: parser.error('max-requests must be positive')
    result=execute(report_only=args.report_only,max_requests=args.max_requests)
    print(json.dumps({k:result[k] for k in ('outcome','selected_ids','metadata_attempted_ids',
        'metadata_observed_ids','exact_id_matches','coordinate_pairs','requests_dispatched','http_statuses','job_states')}),flush=True)


if __name__=='__main__':
    main()

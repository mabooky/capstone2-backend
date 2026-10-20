"""Read-only, network-disabled final collection audit; writes only a NEW report directory."""
import argparse
import csv
import json
import socket
import subprocess
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from uuid import UUID

from clean_muse import LOCAL, SOURCE_DIR, load_configs, number, normalize
from reccobeats_batch import population
from reccobeats_full import LIVE_ROOT, SOURCE, SIZES
from reccobeats_research import distribution
from verify_reccobeats_multifeature import digest, readonly


def summarize(values):
    values = sorted(values)
    result = distribution(values)
    if not values:
        return result
    def quantile(p):
        position = (len(values)-1)*p
        i = int(position)
        return values[i]+(values[min(i+1, len(values)-1)]-values[i])*(position-i)
    q1, q3 = quantile(.25), quantile(.75)
    lo, hi = q1-1.5*(q3-q1), q3+1.5*(q3-q1)
    result.update(p01=quantile(.01), p05=quantile(.05), p25=q1,
                  p75=q3, p95=quantile(.95), p99=quantile(.99),
                  tukey_fences=[lo, hi], tukey_outliers=sum(x < lo or x > hi for x in values),
                  abs_z_over_3=sum(abs(x-result['mean']) > 3*result['stddev'] for x in values))
    return result


def audit(output):
    output = output.resolve()
    if not output.is_relative_to(LOCAL.resolve()) or output.exists():
        raise ValueError('Use a NEW directory under music/.local')
    # No source checkpoint constructor, lock, collector runner, or transport is used.
    protected = sorted(p for root in (LIVE_ROOT, SOURCE, SOURCE_DIR,
        LOCAL/'muse-cleaned/full-90408-v1') for p in root.rglob('*') if p.is_file())
    before = {str(p.relative_to(LOCAL)): digest(p) for p in protected}
    groups, conflicts, manifest = population()
    chain = []
    previous = SOURCE/'checkpoint.sqlite'
    for size in SIZES:
        path = LIVE_ROOT/f'fixed-{size}-v1/checkpoint.sqlite'
        db = readonly(path)
        try:
            integrity = [r[0] for r in db.execute('PRAGMA integrity_check')]
            fk = list(db.execute('PRAGMA foreign_key_check'))
            # Refuse WAL on the inherited source as well; ATTACH remains immutable.
            old = readonly(previous)
            old.close()
            db.execute('ATTACH DATABASE ? AS prior', (previous.resolve().as_uri()+'?mode=ro&immutable=1',))
            preserved = {}
            for table in ('jobs', 'attempts', 'research_calls', 'research_features'):
                preserved[table] = db.execute(f'SELECT count(*) FROM (SELECT * FROM prior.{table} '
                    f'EXCEPT SELECT * FROM main.{table})').fetchone()[0] == 0
            chain.append(dict(size=size, integrity=integrity, foreign_key_errors=len(fk), inherited=preserved))
        finally:
            db.close()
        previous = path
    db = readonly(previous)
    try:
        candidates = {r['sid']: dict(r) for r in db.execute('SELECT * FROM candidates')}
        features = {r['sid']: dict(r) for r in db.execute('SELECT * FROM research_features')}
        jobs = [dict(r) for r in db.execute('SELECT * FROM jobs')]
        attempts = [dict(r) for r in db.execute('SELECT * FROM attempts')]
        calls = {(r['job_key'], r['attempt']) for r in db.execute('SELECT * FROM research_calls')}
        saved_manifest = json.loads(db.execute("SELECT value FROM meta WHERE key='manifest'").fetchone()[0])
        synthetic = db.execute("SELECT count(*) FROM meta WHERE key='offline_synthetic_validation'").fetchone()[0]
    finally:
        db.close()
    metadata_ids = [sid for job in jobs if job['stage']=='metadata' for sid in json.loads(job['ids'])]
    attempted_ids = {sid for job in jobs if job['stage']=='metadata' and job['attempts']>0 for sid in json.loads(job['ids'])}
    checks = dict(population=set(candidates)==set(groups) and len(candidates)==60741,
        source_checksum=saved_manifest['source_sha256']==manifest['source_sha256'],
        live_not_synthetic=saved_manifest['mode']=='temporary-research-full-60741-v1' and synthetic==0,
        metadata_once=len(metadata_ids)==len(set(metadata_ids))==60741 and set(metadata_ids)==set(groups),
        all_ids_attempted=attempted_ids==set(groups),
        all_observed=all(c['metadata_outcome'] is not None for c in candidates.values()),
        all_terminal=all(j['state']=='done' for j in jobs),
        all_attempts_resolved=all(a['status'] is not None for a in attempts),
        attempt_calls={(a['job_key'],a['attempt']) for a in attempts}==calls,
        chain=all(c['integrity']==['ok'] and c['foreign_key_errors']==0 and all(c['inherited'].values()) for c in chain),
        refs=all(json.loads(c['refs'])==sorted(r['external_id'] for r in groups[sid]) and
            json.loads(c['conflict'])==conflicts.get(sid) for sid,c in candidates.items()))
    attempt_counts = Counter(a['job_key'] for a in attempts)
    checks['attempt_counts'] = all(j['attempts']==attempt_counts[j['key']] for j in jobs)
    comparisons = [x for c in candidates.values() for x in json.loads(c['comparisons'] or '[]')]
    checks['all_hold'] = all(x['decision']=='hold' for x in comparisons)
    valid, errors = set(), Counter()
    for sid, f in features.items():
        c = candidates.get(sid)
        issues = []
        if not c or sid not in groups:
            issues.append('orphan')
        else:
            comp = json.loads(c['comparisons'] or '[]')
            if not (c['metadata_outcome']=='matched_href' and c['feature_outcome']=='both_available'
                    and not c['collision'] and json.loads(c['conflict']) is None and comp
                    and sorted(x['external_id'] for x in comp)==json.loads(c['refs'])
                    and all(x['title_match'] is True and x['artist_match'] is True for x in comp)):
                issues.append('identity_or_outcome')
            try:
                if str(UUID(c['uuid']))!=c['uuid']:
                    issues.append('uuid')
            except (ValueError, TypeError, AttributeError):
                issues.append('uuid')
        for raw,norm in [('valence','normalized_valence'),('energy','normalized_arousal')]:
            if f[raw] is None or f[norm] is None:
                issues.append('missing_'+raw)
                continue
            try:
                x,y=number(f[raw]),number(f[norm])
                if not 0<=x<=1 or not -1<=y<=1:
                    issues.append('range_'+raw)
                if y!=2*x-1:
                    issues.append('normalization_'+raw)
            except Exception:
                issues.append('invalid_'+raw)
        errors.update(issues)
        if not issues:
            valid.add(sid)
    uuids = Counter(c['uuid'] for c in candidates.values() if c['uuid'])
    checks['valid_pairs'] = len(valid)==len(features)==27948 and not errors
    checks['unique_feature_uuids'] = len({candidates[s]['uuid'] for s in features})==len(features)
    checks['pair_outcomes'] = {s for s,c in candidates.items() if c['feature_outcome']=='both_available'}==set(features)
    raw = defaultdict(list)
    with (SOURCE_DIR/'muse_dataset.csv').open(encoding='utf-8-sig', newline='') as stream:
        for r in csv.DictReader(stream):
            sid=r['spotify_id'].strip()
            if sid in groups:
                raw[sid].append(r)
    configs = load_configs(Path(__file__).resolve().parents[1]/'db/002_normalization_v1.sql')
    muse_eligible = set()
    for sid, rows in raw.items():
        if len(rows)!=1:
            continue
        r=rows[0]
        for cfg in configs.values():
            normalize(number(r[cfg['metric']+'_tags']),number(cfg['raw_min']),number(cfg['raw_max']))
        muse_eligible.add(sid)
    views = dict(A=len(valid), B1=len(muse_eligible), B2=len(muse_eligible),
                 C1=len(valid & muse_eligible), C2=len(valid & muse_eligible))
    coordinates = {k:[float(features[s][k]) for s in sorted(valid)] for k in
        ('valence','energy','normalized_valence','normalized_arousal')}
    quadrants=Counter(('-' if x<0 else '+')+('-' if y<0 else '+') for x,y in
        zip(coordinates['normalized_valence'],coordinates['normalized_arousal']))
    pair_counts = Counter((Decimal(features[s]['valence']),Decimal(features[s]['energy'])) for s in valid)
    strict = {s for s,c in candidates.items() if (comp:=json.loads(c['comparisons'] or '[]'))
        and all(x['title_match'] is True and x['artist_match'] is True for x in comp)}
    mismatch=Counter()
    for c in candidates.values():
        comp=json.loads(c['comparisons'] or '[]')
        t=any(x['title_match'] is False for x in comp)
        a=any(x['artist_match'] is False for x in comp)
        if t or a:
            mismatch['both' if t and a else 'title_only' if t else 'artist_only']+=1
    progress=json.loads((LIVE_ROOT/'progress.json').read_text(encoding='utf-8'))
    checks['saved_summary'] = (progress['outcome']=='completed' and progress['coordinate_pairs']==len(valid)
        and progress['request_attempts']==len(attempts)==19213)
    after={str(p.relative_to(LOCAL)):digest(p) for p in protected}
    checks['protected_files_unchanged']=before==after
    checks['protected_inventory_unchanged']=protected==sorted(p for root in (LIVE_ROOT,SOURCE,SOURCE_DIR,
        LOCAL/'muse-cleaned/full-90408-v1') for p in root.rglob('*') if p.is_file())
    result=dict(result='PASS' if all(checks.values()) else 'FAIL', checks=checks,
        actual_api_calls=0, verified_transitions=0, shared_db_connections=0,
        population=len(candidates), request_attempts=len(attempts), coordinate_pairs=len(valid),
        metadata_outcomes=dict(Counter(c['metadata_outcome'] for c in candidates.values())),
        feature_outcomes=dict(Counter(c['feature_outcome'] or 'not_requested' for c in candidates.values())),
        job_states=dict(Counter(j['state'] for j in jobs)), http_statuses=dict(Counter(a['status'] for a in attempts)),
        retries=sum(a['attempt']>1 for a in attempts),
        strict_metadata_ids=len(strict), strict_without_pairs=dict(Counter(candidates[s]['feature_outcome'] for s in strict-valid)),
        metadata_mismatch_ids=dict(mismatch), pair_errors=dict(errors),
        collision_candidates=sum(c['collision']!=0 for c in candidates.values()),
        duplicated_uuid_groups=sum(n>1 for n in uuids.values()),
        duplicate_coordinate_groups=sum(n>1 for n in pair_counts.values()),
        duplicate_coordinate_excess=sum(n-1 for n in pair_counts.values()),
        muse=dict(unique_ids=len(raw), referenced_rows=sum(map(len,raw.values())),
            unique_single_row_ids=len(muse_eligible), duplicate_id_groups=len(conflicts),
            linked_coordinate_ids=len(valid & set(raw)), linked_coordinate_rows=sum(len(raw[s]) for s in valid),
            duplicate_ids_with_pairs=len(valid & set(conflicts))),
        views=dict(current_verified_selected={v:0 for v in views},
            conservative_candidates_after_review=views,
            id_only_upper_bound_including_unresolved_duplicates=dict(A=len(valid),B1=len(raw),B2=len(raw),C1=len(valid),C2=len(valid)),
            basis='Existing SQL requires verified+selected. Counts are offline source eligibility, not a shared DB query. '
                  'No actual verified transition. Duplicate MuSe IDs excluded from conservative candidates.'),
        distributions={k:summarize(v) for k,v in coordinates.items()}, quadrants=dict(quadrants),
        axes=dict(valence_zero=sum(x==0 for x in coordinates['normalized_valence']),
            arousal_zero=sum(x==0 for x in coordinates['normalized_arousal'])),
        extremes={k:dict(at_zero=sum(x==0 for x in v),at_one=sum(x==1 for x in v),
            below_001=sum(x<.01 for x in v),above_099=sum(x>.99 for x in v)) for k,v in coordinates.items() if k in ('valence','energy')},
        checkpoint_chain=chain, protected_sha256=before,
        distribution_note='Filtered strict-match sample; Energy is the existing arousal proxy. Outliers are descriptive, not exclusions.')
    output.mkdir(parents=True,exist_ok=False)
    (output/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return {k:result[k] for k in ('result','population','coordinate_pairs','request_attempts','pair_errors','muse','views')}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir',type=Path,required=True)
    args=parser.parse_args()
    with patch.object(socket,'socket',side_effect=AssertionError('Network forbidden')), \
         patch.object(subprocess,'Popen',side_effect=AssertionError('External process forbidden')):
        print(json.dumps(audit(args.output_dir),ensure_ascii=False))

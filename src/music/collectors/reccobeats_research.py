"""Explicit fixed 100/1000-ID research; temporary local values, never a music DB load."""
import argparse
import json
import math
import os
import sqlite3
import statistics
import time
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse
from uuid import UUID

from clean_muse import LOCAL
from reccobeats_batch import Checkpoint, Engine, population, exclusive_lock
from reccobeats_probe import memory_records, powershell_transport
from spotify_validate import prepare_sample, select_ids

ROOT = LOCAL / 'reccobeats-research/fixed-100-v1'
INTERVAL = 3
MODE = 'temporary-research-fixed-100-v1'
EXPANDED_MODE = 'temporary-research-fixed-1000-v1'
EXPANDED_ROOT = ROOT.parent / 'fixed-1000-v1'


def valid_scope(cp):
    size=len(cp.groups)
    return ((size, cp.manifest.get('mode')) in ((100, MODE), (1000, EXPANDED_MODE)) or
            (2000<=size<=10000 and size%1000==0 and
             cp.manifest.get('mode')==f'temporary-research-fixed-{size}-v1') or
            (size in (*range(11000,60001,1000),60741) and
             cp.manifest.get('mode')==f'temporary-research-full-{size}-v1'))


def selected_population(size=100):
    # Reuse the original seed/hash sample, never replace misses with easier tracks.
    sample, selected = prepare_sample()
    all_groups, conflicts, manifest = population()
    if len(selected) != 100 or set(selected) - set(all_groups):
        raise ValueError('Expected the fixed 100-ID sample')
    manifest = dict(manifest, mode=MODE, unique_ids=100, sample=sample,
                    scope='local research only; no publication, shared DB, or expansion',
                    provider_storage_reuse_permission='unconfirmed', research_interval=INTERVAL)
    if size == 1000:
        original_ids=set(selected)
        selected = {sid:all_groups[sid] for sid in select_ids(all_groups, count=1000)}
        if not original_ids <= set(selected):
            raise ValueError('Expansion must include original sample')
        manifest.update(mode=EXPANDED_MODE, unique_ids=1000,
            sample={'selection':'same SHA256 seed order as original 100', 'seed':'muse-spotify-unique-100-v1'},
            scope='noncommercial university research; fixed 1000 maximum; local only',
            retention='Delete data, checkpoints and all backup/export copies after December 2026 project end; short-term storage remains subject to terms')
    elif size != 100:
        raise ValueError('Only fixed 100 or 1000 scopes allowed')
    return selected, {sid:conflicts[sid] for sid in selected if sid in conflicts}, manifest


def seed_completed(cp, source_directory=ROOT):
    """Atomic lineage import; keep the original checkpoint intact and never replay its IDs."""
    size=len(cp.groups)
    if not valid_scope(cp) or size<1000:
        raise ValueError('Only bounded research expansions may import')
    previous_size=100 if size==1000 else 60000 if size==60741 else size-1000
    previous_mode=(f'temporary-research-full-{previous_size}-v1' if previous_size>10000
                   else MODE if previous_size==100 else f'temporary-research-fixed-{previous_size}-v1')
    reuse_key='reused_100' if size==1000 else 'reused_previous'
    if cp.get(reuse_key) is not None:
        return
    with exclusive_lock(source_directory / 'collector.lock'):
        source = sqlite3.connect((source_directory / 'checkpoint.sqlite').resolve().as_uri()+'?mode=ro', uri=True)
        source.row_factory = sqlite3.Row
        try:
            manifest = json.loads(source.execute("SELECT value FROM meta WHERE key='manifest'").fetchone()[0])
            if source.execute("SELECT 1 FROM meta WHERE key='offline_synthetic_validation'").fetchone():
                raise ValueError('Offline validation copies cannot seed collection checkpoints')
            rows = source.execute('SELECT * FROM candidates').fetchall()
            if (manifest.get('mode') != previous_mode or len(rows) != previous_size
                    or manifest.get('source_sha256') != cp.manifest.get('source_sha256')
                    or source.execute("SELECT count(*) FROM jobs WHERE state!='done'").fetchone()[0]
                    or source.execute('PRAGMA integrity_check').fetchone()[0] != 'ok'):
                raise ValueError('Previous checkpoint must be complete and compatible')
            for row in rows:
                target=cp.db.execute('SELECT refs,conflict FROM candidates WHERE sid=?',(row['sid'],)).fetchone()
                if target is None or tuple(target) != (row['refs'],row['conflict']):
                    raise ValueError('Original source references/conflicts changed')
            if cp.db.execute('SELECT count(*) FROM attempts').fetchone()[0]:
                raise ValueError('Import requires pristine target')
            old_ids={r['sid'] for r in rows}
            with cp.db:
                cp.db.execute('DELETE FROM jobs')  # Only pristine generated work, never observations.
                for row in rows:
                    cp.db.execute('UPDATE candidates SET uuid=?,metadata_outcome=?,comparisons=?,feature_outcome=?,collision=? WHERE sid=?',
                        tuple(row[k] for k in ('uuid','metadata_outcome','comparisons','feature_outcome','collision','sid')))
                for table in ('jobs','attempts','events','research_features','research_calls'):
                    records=source.execute('SELECT * FROM '+table).fetchall()
                    if records:
                        cp.db.executemany('INSERT INTO '+table+' VALUES('+','.join('?' for _ in records[0])+')',
                                          [tuple(r) for r in records])
                new_ids=sorted(set(cp.groups)-old_ids)
                prefix='metadata:expansion:' if size==1000 else f'metadata:expansion:{size}:'
                cp.db.executemany('INSERT INTO jobs(key,stage,ids) VALUES(?,?,?)',
                    [(f'{prefix}{i//10:06d}','metadata',json.dumps(new_ids[i:i+10])) for i in range(0,len(new_ids),10)])
                cp.put(reuse_key,json.dumps(dict(ids=previous_size,requests=source.execute('SELECT count(*) FROM research_calls').fetchone()[0],
                    coordinate_pairs=source.execute('SELECT count(*) FROM research_features').fetchone()[0])))
                cp.put('expansion_started',str(time.time()))
                wait=source.execute("SELECT value FROM meta WHERE key='not_before'").fetchone()
                if wait: cp.put('not_before',wait[0])
        finally:
            source.close()


class ResearchCheckpoint(Checkpoint):
    def __enter__(self):
        if not valid_scope(self):
            raise ValueError('Research scope must match an explicit bounded cohort mode')
        super().__enter__()
        try:
            self.db.execute('PRAGMA foreign_keys=ON')
            self.db.executescript('''
                CREATE TABLE IF NOT EXISTS research_features (
                    sid TEXT PRIMARY KEY REFERENCES candidates(sid),
                    valence TEXT, energy TEXT, normalized_valence TEXT, normalized_arousal TEXT,
                    observed_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS research_calls (
                    job_key TEXT NOT NULL, attempt INTEGER NOT NULL, completed REAL NOT NULL,
                    elapsed REAL NOT NULL, PRIMARY KEY(job_key,attempt));
            ''')
            return self
        except BaseException:
            super().__exit__(None,None,None)
            raise

    def retry_job(self, key, **kwargs):
        row=self.db.execute('SELECT last_status,reason FROM jobs WHERE key=?',(key,)).fetchone()
        if row and (row['reason'] or '').startswith('batch_member:'):
            raise PermissionError('Retry the parent batch only; never replay a member independently')
        if row and row[0]==403:
            raise PermissionError('403 is an experiment stop; do not bypass or retry')
        return super().retry_job(key,**kwargs)


class ResearchTransport:
    def __init__(self, checkpoint, *, execute=False, send=None):
        if not execute:
            raise PermissionError('Explicit research-live execution is required')
        if not valid_scope(checkpoint):
            raise ValueError('Invalid research population')
        if len(checkpoint.groups)==1000 and checkpoint.get('reused_100') is None:
            raise PermissionError('Original completed 100 must be imported before expansion')
        if len(checkpoint.groups)>1000 and checkpoint.get('reused_previous') is None:
            raise PermissionError('Previous completed cohort must be imported before expansion')
        self.cp, self.send = checkpoint, powershell_transport if send is None else send
        if checkpoint.get('offline_synthetic_validation') is not None and send is None:
            raise PermissionError('Offline validation copy cannot use a live transport')

    def __call__(self, method, url, headers, data):
        parsed=urlparse(url)
        if method!='GET' or data is not None or parsed.scheme!='https' or parsed.netloc!='api.reccobeats.com' or parsed.fragment:
            raise PermissionError('Only original ReccoBeats HTTPS GET allowed')
        jobs=self.cp.db.execute("SELECT * FROM jobs WHERE state='inflight'").fetchall()
        if len(jobs)!=1:
            raise PermissionError('Request must be reserved in the checkpoint')
        job=jobs[0]
        ids=json.loads(job['ids'])
        if not set(ids)<=set(self.cp.groups):
            raise PermissionError('Candidate outside fixed sample')
        if job['stage']=='metadata':
            query=parse_qs(parsed.query)
            if parsed.path!='/v1/track' or set(query)!={'ids'} or len(query['ids'])!=1 or query['ids'][0].split(',')!=ids or not 1<=len(ids)<=10:
                raise PermissionError('Metadata request outside reserved batch')
        else:
            if job['key'].startswith('features:batch:'):
                candidates=batch_candidates(self.cp,ids)
                query=parse_qs(parsed.query)
                members=self.cp.db.execute("SELECT key,ids FROM jobs WHERE state='batched' AND reason=?",
                    ('batch_member:'+job['key'],)).fetchall()
                if (parsed.path!='/v1/audio-features' or set(query)!={'ids'} or len(query['ids'])!=1
                        or query['ids'][0].split(',')!=[c['uuid'] for c in candidates]
                        or sorted(json.loads(m['ids'])[0] for m in members)!=sorted(ids)
                        or any(len(json.loads(m['ids']))!=1 for m in members)):
                    raise PermissionError('Feature request outside reserved batch')
            else:
                candidate=self.cp.db.execute('SELECT * FROM candidates WHERE sid=?',(ids[0],)).fetchone()
                if (len(ids)!=1 or candidate['collision'] or candidate['metadata_outcome']!='matched_href'
                        or candidate['feature_outcome'] is not None or parsed.query
                        or parsed.path!='/v1/track/'+candidate['uuid']+'/audio-features'):
                    raise PermissionError('Unconfirmed feature mapping')
        start=time.perf_counter()
        response=self.send(method,url,headers,data)  # Same native PowerShell path; no fallback, proxy or TLS changes.
        self.cp.db.execute('INSERT INTO research_calls VALUES(?,?,?,?)',
                           (job['key'],job['attempts'],time.time(),time.perf_counter()-start))
        return response


def batch_candidates(cp, ids):
    """Recheck the existing strict identity policy before every batch dispatch."""
    if not 1<=len(ids)<=40 or len(ids)!=len(set(ids)):
        raise PermissionError('Invalid feature batch size or duplicate Spotify ID')
    candidates=[]
    for sid in ids:
        c=cp.db.execute('SELECT * FROM candidates WHERE sid=?',(sid,)).fetchone()
        checks=json.loads(c['comparisons'] or '[]') if c else []
        if (c is None or sid not in cp.groups or c['collision'] or c['metadata_outcome']!='matched_href'
                or c['feature_outcome'] is not None or json.loads(c['conflict']) is not None
                or not checks or not all(x.get('title_match') is True and x.get('artist_match') is True for x in checks)
                or cp.db.execute('SELECT 1 FROM research_features WHERE sid=?',(sid,)).fetchone()):
            raise PermissionError('Unconfirmed or already observed batch candidate')
        if str(UUID(c['uuid']))!=c['uuid']:
            raise PermissionError('Invalid canonical ReccoBeats UUID')
        candidates.append(c)
    if len({c['uuid'] for c in candidates})!=len(ids):
        raise PermissionError('Duplicate ReccoBeats UUID')
    return candidates


class ResearchEngine(Engine):
    def __init__(self, checkpoint, send, **kwargs):
        super().__init__(checkpoint,send,interval_seconds=INTERVAL,**kwargs)

    def features(self, sid, payload):
        super().features(sid,payload)
        internal=self.db.execute('SELECT uuid FROM candidates WHERE sid=?',(sid,)).fetchone()[0]
        observed=datetime.now(timezone.utc).isoformat()
        _,scores=memory_records({'id':internal},{'spotify_id':sid},payload,observed)
        values={r['insert_values']['metric']:(r['insert_values']['raw_value'],r['preview']['normalized_value']) for r in scores}
        v,nv=values.get('valence',(None,None))
        e,ne=values.get('energy',(None,None))
        # Same transaction/savepoint as job completion. Never creates a verified source.
        self.db.execute('INSERT INTO research_features VALUES(?,?,?,?,?,?)',(sid,v,e,nv,ne,observed))


def resolve_feature_404(cp):
    """Reclassify recorded feature absence only; keep attempts, calls and scores intact."""
    resolved=0
    with cp.db:
        for job in cp.db.execute("SELECT * FROM jobs WHERE stage='features' AND state='failed' AND last_status=404").fetchall():
            ids=json.loads(job['ids'])
            if len(ids)!=1 or job['key']!='features:'+ids[0]: continue
            candidate=cp.db.execute('SELECT * FROM candidates WHERE sid=?',(ids[0],)).fetchone()
            if (candidate is None or candidate['metadata_outcome']!='matched_href' or candidate['collision']
                    or candidate['feature_outcome'] is not None or json.loads(candidate['conflict']) is not None): continue
            try:
                UUID(candidate['uuid'])
                checks=json.loads(candidate['comparisons'] or '[]')
            except (ValueError,TypeError,AttributeError): continue
            if not checks or not all(c.get('title_match') is True and c.get('artist_match') is True for c in checks): continue
            attempt=cp.db.execute('SELECT * FROM attempts WHERE job_key=? AND attempt=?',
                                  (job['key'],job['attempts'])).fetchone()
            if (attempt is None or attempt['status']!=404 or
                    not cp.db.execute('SELECT 1 FROM research_calls WHERE job_key=? AND attempt=?',
                                      (job['key'],job['attempts'])).fetchone() or
                    cp.db.execute('SELECT 1 FROM attempts WHERE job_key=? AND status IS NULL',(job['key'],)).fetchone() or
                    cp.db.execute('SELECT 1 FROM research_features WHERE sid=?',(ids[0],)).fetchone()): continue
            cp.db.execute('INSERT INTO events(job_key,kind,detail) VALUES(?,?,?)',
                (job['key'],'feature_404_classified',json.dumps(dict(previous_state=job['state'],
                 previous_reason=job['reason'],http_status=404,action='terminal feature absence; no request'))))
            cp.db.execute("UPDATE candidates SET feature_outcome='not_found' WHERE sid=?",(ids[0],))
            cp.db.execute("UPDATE jobs SET state='done',reason='feature_not_found' WHERE key=?",(job['key'],))
            resolved+=1
    return resolved


def distribution(values):
    if not values:
        return dict(n=0,min=None,max=None,mean=None,median=None,stddev=None)
    return dict(n=len(values),min=min(values),max=max(values),mean=statistics.mean(values),
                median=statistics.median(values),stddev=statistics.pstdev(values))


def verify_expansion(cp, source_directory=ROOT):
    """Offline audit of lineage, uniqueness, pending decisions and exact normalization."""
    from decimal import Decimal
    source=sqlite3.connect((source_directory/'checkpoint.sqlite').resolve().as_uri()+'?mode=ro',uri=True)
    source.row_factory=sqlite3.Row
    try:
        old_ids={r[0] for r in source.execute('SELECT sid FROM candidates')}
        metadata=[json.loads(r[0]) for r in cp.db.execute("SELECT ids FROM jobs WHERE stage='metadata'")]
        flat=[sid for ids in metadata for sid in ids]
        checks={
            f'fixed_{len(cp.groups)}_unique':len(cp.groups)==len(set(flat))==len(flat) and set(flat)==set(cp.groups),
            'integrity':cp.db.execute('PRAGMA integrity_check').fetchone()[0]=='ok',
            'foreign_keys':not cp.db.execute('PRAGMA foreign_key_check').fetchall(),
            'all_source_decisions_hold':all(c['decision']=='hold' for r in cp.db.execute('SELECT comparisons FROM candidates')
                for c in json.loads(r[0] or '[]')),
        }
        old_keys={r[0] for r in source.execute('SELECT key FROM jobs')}
        expansion=[json.loads(r['ids']) for r in cp.db.execute("SELECT key,ids FROM jobs WHERE stage='metadata'") if r['key'] not in old_keys]
        new_count=len(cp.groups)-len(old_ids)
        checks[f'only_{new_count}_new_metadata_ids']=len([s for ids in expansion for s in ids])==new_count and not any(old_ids&set(ids) for ids in expansion)
        for table,keys in [('jobs',('key',)),('attempts',('job_key','attempt')),
                           ('research_calls',('job_key','attempt')),('research_features',('sid',))]:
            preserved=True
            for row in source.execute('SELECT * FROM '+table):
                actual=cp.db.execute('SELECT * FROM '+table+' WHERE '+' AND '.join(k+'=?' for k in keys),
                                     tuple(row[k] for k in keys)).fetchone()
                preserved=preserved and actual is not None and tuple(actual)==tuple(row)
            checks['original_'+table+'_preserved']=preserved
        old_keys={r[0] for r in source.execute('SELECT key FROM jobs')}
        checks['no_original_requests_repeated']=all(r['attempts']==source.execute('SELECT attempts FROM jobs WHERE key=?',(r['key'],)).fetchone()[0]
            for r in cp.db.execute('SELECT * FROM jobs') if r['key'] in old_keys)
        valid=True
        for row in cp.db.execute('SELECT * FROM research_features'):
            for raw,norm in [('valence','normalized_valence'),('energy','normalized_arousal')]:
                if row[raw] is None:
                    valid=valid and row[norm] is None
                else:
                    value=Decimal(row[raw]); normalized=Decimal(row[norm])
                    valid=valid and value.is_finite() and Decimal(0)<=value<=Decimal(1) and normalized==2*value-1
        checks['decimal_range_and_normalization']=valid
        return dict(result='PASS' if all(checks.values()) else 'FAIL',checks=checks)
    finally:
        source.close()


def report(cp, outcome):
    db=cp.db
    count=lambda sql:db.execute(sql).fetchone()[0]
    candidates=db.execute('SELECT * FROM candidates').fetchall()
    observed=[r for r in candidates if r['metadata_outcome'] is not None]
    attempted=set(sid for row in db.execute("SELECT ids FROM jobs WHERE stage='metadata' AND attempts>0") for sid in json.loads(row[0]))
    matched=[r for r in candidates if r['metadata_outcome'] in ('matched_href','uuid_collision','invalid_uuid')]
    strict=[r for r in matched if (checks:=json.loads(r['comparisons'] or '[]')) and
            all(c['title_match'] is True and c['artist_match'] is True for c in checks)]
    checks=[c for r in candidates for c in json.loads(r['comparisons'] or '[]')]
    mismatch_ids={'title_only':0,'artist_only':0,'both':0}
    for candidate in candidates:
        comparisons=json.loads(candidate['comparisons'] or '[]')
        title=any(c['title_match'] is False for c in comparisons)
        artist=any(c['artist_match'] is False for c in comparisons)
        if title or artist:
            mismatch_ids['both' if title and artist else 'title_only' if title else 'artist_only']+=1
    pairs=db.execute('SELECT f.* FROM research_features f JOIN candidates c USING(sid) WHERE valence IS NOT NULL AND energy IS NOT NULL AND c.collision=0').fetchall()
    starts=[r[0] for r in db.execute('SELECT started FROM attempts ORDER BY started')]
    completed=[r[0] for r in db.execute('SELECT completed FROM research_calls')]
    span=max(completed)-min(starts) if starts and completed else None
    intervals=[b-a for a,b in zip(starts,starts[1:])]
    latencies=[r[0] for r in db.execute('SELECT elapsed FROM research_calls')]
    requests=count('SELECT count(*) FROM research_calls')
    reused=json.loads(cp.get('reused_previous',cp.get('reused_100','null')))
    expansion_start=cp.get('expansion_started')
    new_starts=[r[0] for r in db.execute('SELECT started FROM attempts WHERE started>=? ORDER BY started',
                                         (float(expansion_start),))] if expansion_start else []
    new_completed=[r[0] for r in db.execute('SELECT completed FROM research_calls WHERE completed>=?',
                                            (float(expansion_start),))] if expansion_start else []
    new_intervals=[b-a for a,b in zip(new_starts,new_starts[1:])]
    new_span=max(new_completed)-min(new_starts) if new_completed and new_starts else None
    upper=math.ceil(60741/10)+60741
    quarantined_upper=upper-cp.manifest.get('duplicate_groups',0)
    v=[float(r['valence']) for r in pairs]; e=[float(r['energy']) for r in pairs]
    nv=[float(r['normalized_valence']) for r in pairs]; na=[float(r['normalized_arousal']) for r in pairs]
    return dict(mode=cp.manifest['mode'],outcome=outcome,selected_ids=len(cp.groups),sample_source_rows=sum(map(len,cp.groups.values())),
        reused=reused,
        expansion_requests=requests-(reused['requests'] if reused else 0),
        expansion_api_span_seconds=new_span,expansion_start_intervals=distribution(new_intervals),
        expansion_requests_per_second=(requests-reused['requests'])/new_span if new_span and reused else None,
        request_attempts=count('SELECT count(*) FROM attempts'),
        request_stages=dict(db.execute('SELECT stage,count(*) FROM attempts a JOIN jobs j ON j.key=a.job_key GROUP BY stage')),
        feature_batch_protocol=cp.get('feature_batch_protocol'),
        feature_batch_requests=count("SELECT count(*) FROM attempts WHERE job_key LIKE 'features:batch:%'"),
        pending_feature_ids=count("SELECT count(*) FROM candidates WHERE uuid IS NOT NULL AND collision=0 "
            "AND metadata_outcome='matched_href' AND feature_outcome IS NULL"),
        sample_duplicate_groups=len(cp.conflicts),metadata_attempted_ids=len(attempted),metadata_observed_ids=len(observed),
        unqueried_ids=len(cp.groups)-len(attempted),unresolved_ids=len(attempted)-len(observed),exact_id_matches=len(matched),strict_metadata_matches=len(strict),
        exact_id_match_rate_among_observed=len(matched)/len(observed) if observed else None,
        strict_match_rate_among_observed=len(strict)/len(observed) if observed else None,
        title_mismatch_sources=sum(c['title_match'] is False for c in checks),
        artist_mismatch_sources=sum(c['artist_match'] is False for c in checks),
        metadata_mismatch_ids=mismatch_ids,
        metadata_outcomes=dict(db.execute('SELECT coalesce(metadata_outcome,\'unqueried\'),count(*) FROM candidates GROUP BY metadata_outcome')),
        feature_outcomes=dict(db.execute('SELECT coalesce(feature_outcome,\'not_requested\'),count(*) FROM candidates GROUP BY feature_outcome')),
        coordinate_pairs=len(pairs),temporary_feature_rows=count('SELECT count(*) FROM research_features'),
        valence=distribution(v),energy=distribution(e),normalized_valence=distribution(nv),normalized_arousal=distribution(na),
        quadrants={key:sum((x>=0)==positive_v and (y>=0)==positive_a for x,y in zip(nv,na))
                   for key,positive_v,positive_a in [('--',False,False),('-+',False,True),('+-',True,False),('++',True,True)]},
        requests_dispatched=requests,retries=count('SELECT count(*) FROM attempts WHERE attempt>1'),
        unresolved_request_attempts=count('SELECT count(*) FROM attempts WHERE status IS NULL'),
        http_statuses=dict(db.execute('SELECT coalesce(status,-1),count(*) FROM attempts GROUP BY status')),
        job_states=dict(db.execute('SELECT state,count(*) FROM jobs GROUP BY state')),
        minimum_start_interval_seconds=min(intervals) if intervals else None,elapsed_span_seconds=span,
        start_intervals=distribution(intervals),
        request_latency=distribution(latencies),requests_per_second=requests/span if span and requests else None,
        full_collection_conditional=dict(max_requests_without_retries=upper,
            minimum_spacing_seconds=(upper-1)*INTERVAL,
            max_requests_with_known_duplicate_holds=quarantined_upper,
            minimum_spacing_with_duplicate_holds_seconds=(quarantined_upper-1)*INTERVAL,
            observed_pacing_seconds=(upper-1)*statistics.median(intervals)+statistics.mean(latencies) if intervals and latencies else None,
            note='Median observed start interval; cost scenario only, not coverage extrapolation or authorization; retries/quotas/checks add time'),
        actual_verified=0,shared_db_inserts=0,remote_metadata_retained=False,
        permission='User-authorized temporary local research; provider bulk/storage/reuse rights remain unconfirmed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--research-live',action='store_true',required=True)
    parser.add_argument('--max-requests',type=int)
    parser.add_argument('--report-only',action='store_true')
    parser.add_argument('--research-size',type=int,choices=(100,1000),default=100)
    args=parser.parse_args()
    if args.max_requests is not None and not 1<=args.max_requests<=math.ceil(args.research_size*1.1*1.05):
        parser.error('max-requests exceeds fixed experiment request budget')
    groups,conflicts,manifest=selected_population(args.research_size)
    root=ROOT if args.research_size==100 else EXPANDED_ROOT
    with ResearchCheckpoint(root,groups,conflicts,manifest) as cp:
        if args.research_size==1000: seed_completed(cp)
        if args.report_only:
            outcome='report_only'
        else:
            transport=ResearchTransport(cp,execute=True)
            engine=ResearchEngine(cp,transport)
            outcome=engine.run(args.max_requests)
        result=report(cp,outcome)
        if args.research_size==1000:
            audit=verify_expansion(cp)
            (root/'verification.json').write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
            if audit['result']!='PASS': raise ValueError('Expansion lineage/integrity audit failed')
        snapshot=root/('report-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.json')
        snapshot.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        temp=root/'summary.tmp'
        temp.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        os.replace(temp,root/'summary.json')
        print(json.dumps({k:result[k] for k in ['outcome','metadata_attempted_ids','metadata_observed_ids','exact_id_matches',
            'strict_metadata_matches','coordinate_pairs','requests_dispatched','http_statuses','job_states']}))


if __name__=='__main__':
    main()

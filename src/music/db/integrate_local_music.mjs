// Explicitly authorized isolated integration. Existing schema, loader and inputs stay unchanged.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { entries } from './load_muse_batches.mjs';
import { music, sourceColumns, key, inputs, openDatabase, localDirectory,
    load, counts, viewCounts, q, replayQuery, shaFile } from './persistent_muse.mjs';

// No API, remote PostgreSQL, telemetry or implicit transport fallback.
const forbidden=()=>{throw new Error('Network forbidden in local integration');};
net.Socket.prototype.connect=forbidden;
http.request=http.get=https.request=https.get=forbidden;
globalThis.fetch=forbidden;

const self=fileURLToPath(import.meta.url);
const expected={songs:0,song_sources:118356,emotion_scores:417528};
const expectedCandidates={A:27948,B1:59678,B2:59678,C1:27948,C2:27948};
const writeNew=(path,data)=>writeFile(path,JSON.stringify(data,null,2)+'\n',{flag:'wx'});

async function integrationInputs(root) {
    const muse=await inputs();
    const stage=resolve(root,'reccobeats-staging');
    const recco=JSON.parse(await readFile(resolve(stage,'manifest.json'),'utf8'));
    assert.equal(recco.result,'PASS'); assert.equal(recco.sources,27948); assert.equal(recco.scores,55896);
    for(const [name,sha] of Object.entries(recco.artifacts_sha256))
        assert.equal(await shaFile(resolve(stage,name)),sha);
    assert.equal(await shaFile(resolve(music,'.local',recco.source_checkpoint)),recco.checkpoint_sha256);
    return {stats:muse.stats,stage,manifest:{version:'integrated-local-music-v1',
        muse:muse.manifest,reccobeats:{checkpoint_sha256:recco.checkpoint_sha256,
            verification_sha256:recco.verification_sha256,input_sha256:recco.artifacts_sha256},
        policy:'all-real-sources-pending-unselected; songs-empty; no-auto-merge'}};
}

export async function loadReccobeats(db,stage,progressFile,stopAfterBatches=Infinity) {
    const metrics={inserted_sources:0,inserted_scores:0};
    const run=replayQuery(metrics,stopAfterBatches);
    const iterator=entries(resolve(stage,'emotion_scores.jsonl'))[Symbol.asyncIterator]();
    let batch=[],seen=0,checks=0,batches=0;
    const naturalKeys=new Set();
    await writeFile(progressFile,'',{flag:'wx'});
    const commit=async()=>{
        const scores=[];
        for(let i=0;i<batch.length*2;i++) {
            const next=await iterator.next(); assert.ok(!next.done); scores.push(next.value);
        }
        await db.exec('BEGIN');
        try {
            for(const s of batch) {
                assert.deepEqual(Object.keys(s).sort(),[...sourceColumns].sort());
                assert.equal(s.provider,'reccobeats'); assert.equal(s.match_status,'pending');
                assert.equal(s.song_id,null); assert.equal(s.is_recommendation_source,false);
                assert.ok(!naturalKeys.has(key(s))); naturalKeys.add(key(s)); checks+=6;
            }
            const stored=await run(db,`INSERT INTO music.song_sources(${sourceColumns.join(',')})`,[JSON.stringify(batch)]);
            assert.equal(stored.length,batch.length);
            const ids=new Map(stored.map(s=>[key(s),s.id]));
            const original=new Map(batch.map(s=>[key(s),s]));
            for(const s of stored) {
                const src=original.get(key(s)); assert.ok(src);
                assert.deepEqual(s.raw_payload,src.raw_payload);
                assert.equal(s.candidate_spotify_id,src.candidate_spotify_id);
                assert.equal(s.match_status,'pending'); assert.equal(s.song_id,null);
                assert.equal(s.is_recommendation_source,false); checks+=6;
            }
            const payload=scores.map(e=>{
                const id=ids.get(key(e.source_key)); assert.ok(id!==undefined);
                return {song_source_id:id,...e.insert_values};
            });
            assert.equal(new Set(payload.map(s=>JSON.stringify([s.song_source_id,s.metric]))).size,batch.length*2);
            await run(db,'INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)',[JSON.stringify(payload)]);
            const audited=payload.map((p,i)=>({...p,normalized:scores[i].preview.normalized_value}));
            const mismatch=await q(db,`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS x(song_source_id bigint,metric text,raw_value numeric,normalization_version text,normalized numeric))
                SELECT count(*)::int AS n FROM incoming i LEFT JOIN music.emotion_scores e
                ON (e.song_source_id,e.metric,e.normalization_version)=(i.song_source_id,i.metric,i.normalization_version)
                WHERE e.id IS NULL OR e.raw_value IS DISTINCT FROM i.raw_value
                OR e.normalized_value IS DISTINCT FROM i.normalized
                OR e.raw_min<>0 OR e.raw_max<>1`,[JSON.stringify(audited)]);
            assert.equal(mismatch[0].n,0); checks+=payload.length;
            await db.exec('COMMIT');
        } catch(error) { await db.exec('ROLLBACK'); throw error; }
        seen+=batch.length; batches++;
        batch=[];
    };
    let outcome='completed';
    try {
        for await(const src of entries(resolve(stage,'song_sources.jsonl'))) {
            batch.push(src);
            if(batch.length===500) await commit();
        }
        if(batch.length) await commit();
        assert.ok((await iterator.next()).done); assert.equal(seen,27948);
    } catch(error) {
        if(error.code!=='BOUNDARY_STOP') throw error;
        outcome='interrupted_at_committed_boundary';
    } finally { await iterator.return(); }
    const result={outcome,...metrics,checks,committed_input_sources:seen,batches};
    // This new per-run file is diagnostic only; resume derives progress from immutable DB keys.
    await writeFile(progressFile,JSON.stringify(result)+'\n');
    return result;
}

export async function fingerprints(db) {
    const result={};
    for(const table of ['songs','song_sources','emotion_scores']) {
        const hash=createHash('sha256'); let after='0',seen=0;
        while(true) {
            const rows=await q(db,`SELECT id::text,md5(to_jsonb(t)::text) AS hash FROM music.${table} t
                WHERE t.id>$1::bigint ORDER BY t.id LIMIT 2000`,[after]);
            for(const row of rows) {
                assert.ok(BigInt(row.id)>BigInt(after),'Fingerprint pagination must use numeric PK order');
                hash.update(row.id+':'+row.hash+'\n'); after=row.id; seen++;
            }
            if(!rows.length) break;
        }
        assert.equal(seen,(await q(db,`SELECT count(*)::int n FROM music.${table}`))[0].n);
        result[table]=hash.digest('hex');
    }
    return result;
}

async function audit(db,full=false) {
    const count=await counts(db), actualViews=await viewCounts(db);
    if(full) assert.deepEqual(count,expected);
    assert.ok(Object.values(actualViews).every(n=>n===0));
    const invalid=(await q(db,`SELECT count(*)::int n FROM music.song_sources
        WHERE song_id IS NOT NULL OR match_status<>'pending' OR verified_at IS NOT NULL
        OR match_evidence IS NOT NULL OR is_recommendation_source`))[0].n;
    assert.equal(invalid,0);
    const orphans=(await q(db,`SELECT count(*)::int n FROM music.emotion_scores e
        LEFT JOIN music.song_sources s ON s.id=e.song_source_id WHERE s.id IS NULL`))[0].n;
    assert.equal(orphans,0);
    assert.equal((await q(db,`SELECT count(*)::int n FROM music.emotion_scores WHERE
        normalized_value IS DISTINCT FROM 2*(raw_value-raw_min)/(raw_max-raw_min)-1
        OR normalized_value NOT BETWEEN -1 AND 1`))[0].n,0);
    const providers=await q(db,`SELECT s.provider,count(DISTINCT s.id)::int sources,count(e.id)::int scores
        FROM music.song_sources s LEFT JOIN music.emotion_scores e ON s.id=e.song_source_id
        GROUP BY s.provider ORDER BY s.provider`);
    if(full) {
        assert.deepEqual(providers,[{provider:'muse',sources:90408,scores:361632},
            {provider:'reccobeats',sources:27948,scores:55896}]);
        assert.equal((await q(db,`SELECT count(DISTINCT candidate_spotify_id)::int n
            FROM music.song_sources WHERE candidate_spotify_id IS NOT NULL`))[0].n,60741);
        assert.deepEqual((await q(db,`SELECT count(*)::int groups,sum(n)::int rows FROM
            (SELECT count(*) n FROM music.song_sources WHERE provider='muse' AND candidate_spotify_id IS NOT NULL
            GROUP BY candidate_spotify_id HAVING count(*)>1) x`))[0],{groups:1063,rows:2224});
        assert.equal((await q(db,`SELECT count(*)::int n FROM music.song_sources WHERE provider='muse'
            AND ((raw_payload->>'valence_tags')::numeric<1 OR (raw_payload->>'arousal_tags')::numeric<1)`))[0].n,333);
        assert.equal((await q(db,`SELECT count(*)::int n FROM music.song_sources WHERE provider='muse'
            AND candidate_spotify_id IS NULL`))[0].n,28506);
        const pkFkUnique=await q(db,`SELECT contype,count(*)::int n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
            JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname='music' AND contype IN ('p','f','u')
            GROUP BY contype ORDER BY contype`);
        assert.deepEqual(pkFkUnique,[{contype:'f',n:3},{contype:'p',n:3},{contype:'u',n:4}]);
    }
    return {counts:count,providers,views:actualViews,all_real_sources_pending:true,orphan_scores:orphans};
}

// Source-level projections for review, NOT actual VIEW rows and NOT source promotion.
export async function candidateAudit(db) {
    // Fresh bulk-loaded databases can lack useful planner statistics.
    // Planner statistics prevent quadratic joins; this changes no source/score rows.
    await db.exec('ANALYZE music.song_sources; ANALYZE music.emotion_scores;');
    const prefix=`WITH single_muse AS (
        SELECT min(id) id,candidate_spotify_id sid FROM music.song_sources WHERE provider='muse'
        AND candidate_spotify_id IS NOT NULL GROUP BY candidate_spotify_id HAVING count(*)=1
    ), projections AS NOT MATERIALIZED (
        SELECT s.id,s.candidate_spotify_id sid,s.provider,e.metric,e.normalization_version,e.raw_value,e.normalized_value
        FROM music.song_sources s JOIN music.emotion_scores e ON e.song_source_id=s.id
    ) `;
    const definitions={
        A:['reccobeats','reccobeats-v1','reccobeats','energy','reccobeats-v1'],
        B1:['muse','muse-theoretical-v1','muse','arousal','muse-theoretical-v1'],
        B2:['muse','muse-observed-v1','muse','arousal','muse-observed-v1'],
        C1:['reccobeats','reccobeats-v1','muse','arousal','muse-theoretical-v1'],
        C2:['reccobeats','reccobeats-v1','muse','arousal','muse-observed-v1']};
    const result={};
    for(const [view,args] of Object.entries(definitions)) {
        const rows=await q(db,prefix+`SELECT v.sid,v.id AS valence_source_id,a.id AS arousal_source_id,
            v.normalized_value::text valence,a.normalized_value::text arousal
            FROM projections v JOIN projections a ON a.sid=v.sid JOIN single_muse m ON m.sid=v.sid
            WHERE v.provider=$1 AND v.metric='valence' AND v.normalization_version=$2
            AND a.provider=$3 AND a.metric=$4 AND a.normalization_version=$5
            AND (v.provider<>'muse' OR v.id=m.id) AND (a.provider<>'muse' OR a.id=m.id)
            ORDER BY v.sid`,args);
        assert.equal(rows.length,expectedCandidates[view]);
        assert.equal(new Set(rows.map(r=>r.sid)).size,rows.length);
        result[view]=rows;
    }
    // All 27,948 hybrid pairs must use precisely A's V and the corresponding B1/B2 A.
    const maps=Object.fromEntries(Object.entries(result).map(([v,rows])=>[v,new Map(rows.map(r=>[r.sid,r]))]));
    for(const [c,b] of [['C1','B1'],['C2','B2']]) for(const row of result[c]) {
        assert.equal(row.valence,maps.A.get(row.sid).valence);
        assert.equal(row.valence_source_id,maps.A.get(row.sid).valence_source_id);
        assert.equal(row.arousal,maps[b].get(row.sid).arousal);
        assert.equal(row.arousal_source_id,maps[b].get(row.sid).arousal_source_id);
    }
    let intersection=0;
    for(const row of result.A) if(Object.values(maps).every(map=>map.has(row.sid))) intersection++;
    assert.equal(intersection,27948);
    return {counts:Object.fromEntries(Object.entries(result).map(([v,rows])=>[v,rows.length])),
        common_candidates:intersection,hybrid_coordinate_checks:27948*2*4,
        basis:'pending source projections; singleton MuSe IDs only; actual verified VIEWs remain empty'};
}

async function constraintTests(db) {
    const results=[];
    await db.exec('BEGIN');
    const reject=async(name,sql,args,code,run=q)=>{
        await db.exec('SAVEPOINT probe');
        try {
            let error; try { await run(db,sql,args); } catch(e) {error=e;}
            assert.ok(error,name); assert.equal(error.code,code,name); results.push(name);
        } finally { await db.exec('ROLLBACK TO probe; RELEASE probe'); }
    };
    try {
        const src=(await q(db,"SELECT * FROM music.song_sources WHERE provider='reccobeats' ORDER BY id LIMIT 1"))[0];
        const score=(await q(db,'SELECT * FROM music.emotion_scores WHERE song_source_id=$1 LIMIT 1',[src.id]))[0];
        await reject('source_natural_unique',`INSERT INTO music.song_sources(${sourceColumns.join(',')})
            SELECT ${sourceColumns.join(',')} FROM music.song_sources WHERE id=$1`,[src.id],'23505');
        await reject('source_pk',`INSERT INTO music.song_sources(id,${sourceColumns.join(',')}) OVERRIDING SYSTEM VALUE
            SELECT id,${sourceColumns.join(',')} FROM music.song_sources WHERE id=$1`,[src.id],'23505');
        await reject('score_unique',`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            SELECT song_source_id,metric,raw_value,normalization_version FROM music.emotion_scores WHERE id=$1`,[score.id],'23505');
        await reject('score_fk',`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES(9223372036854775807,'energy',0.5,'reccobeats-v1')`,[],'23503');
        await reject('pending_canonical_link',"UPDATE music.song_sources SET song_id=1 WHERE id=$1",[src.id],'23514');
        await reject('unreviewed_promotion',"UPDATE music.song_sources SET match_status='verified' WHERE id=$1",[src.id],'23514');
        await reject('pending_selection',"UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1",[src.id],'23514');
        await reject('immutable_observation',"UPDATE music.song_sources SET raw_payload='{}' WHERE id=$1",[src.id],'55000');
        await reject('immutable_score',"UPDATE music.emotion_scores SET raw_value=raw_value WHERE id=$1",[score.id],'55000');
        const replay=replayQuery({inserted_sources:0,inserted_scores:0});
        const changed=Object.fromEntries(sourceColumns.map(c=>[c,src[c]]));
        changed.raw_payload={conflicting:true};
        await reject('conflicting_source_replay',`INSERT INTO music.song_sources(${sourceColumns.join(',')})`,
            [JSON.stringify([changed])],'INPUT_CONFLICT',replay);
        await reject('conflicting_score_replay','INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)',
            [JSON.stringify([{song_source_id:src.id,metric:score.metric,raw_value:Number(score.raw_value)===0?'.1':'0',
                normalization_version:score.normalization_version}])],'INPUT_CONFLICT',replay);
        // Synthetic canonical linkage only, enclosed in a rolled-back transaction.
        const sid='Z'.repeat(22);
        const song=(await q(db,"INSERT INTO music.songs(spotify_id,title,artist) VALUES($1,'Synthetic','Fixture') RETURNING id",[sid]))[0].id;
        await reject('song_unique',"INSERT INTO music.songs(spotify_id,title,artist) VALUES($1,'Fixture','Fixture')",[sid],'23505');
        await reject('song_pk',`INSERT INTO music.songs(id,spotify_id,title,artist) OVERRIDING SYSTEM VALUE
            VALUES($1,$2,'Fixture','Fixture')`,[song,'X'.repeat(22)],'23505');
        const linked=(await q(db,`INSERT INTO music.song_sources(song_id,provider,external_id,source_version,source_url,
            rights_reference,candidate_spotify_id,match_status,match_evidence,verified_at,is_recommendation_source)
            VALUES($1,'reccobeats','synthetic-linkage-fixture','fixture','fixture','synthetic-only',$2,
            'verified','{"method":"synthetic-only","reference":"rollback fixture"}',now(),true) RETURNING id`,[song,sid]))[0].id;
        await q(db,`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES($1,'valence',0.25,'reccobeats-v1'),($1,'energy',0.75,'reccobeats-v1')`,[linked]);
        assert.equal((await q(db,'SELECT song_id FROM music.recommend_a WHERE song_id=$1',[song]))[0].song_id,song);
        await reject('composite_song_spotify_fk',`INSERT INTO music.song_sources(song_id,provider,external_id,source_version,
            source_url,rights_reference,candidate_spotify_id,match_status,match_evidence,verified_at)
            VALUES($1,'muse','synthetic-bad-link','fixture','fixture','fixture',$2,'verified',
            '{"method":"synthetic","reference":"synthetic"}',now())`,[song,'Y'.repeat(22)],'23503');
        const rangeSource=(await q(db,`INSERT INTO music.song_sources(provider,external_id,source_version,source_url,rights_reference)
            VALUES('reccobeats','synthetic-range','fixture','fixture','synthetic-only') RETURNING id`))[0].id;
        await reject('recco_range',`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES($1,'energy',2,'reccobeats-v1')`,[rangeSource],'23514');
        results.push('synthetic_song_source_score_view_link');
    } finally { await db.exec('ROLLBACK'); }
    assert.deepEqual(await counts(db),expected);
    return {passed:results.length,cases:results,synthetic_fixture_rolled_back:true,real_sources_promoted:0};
}

async function worker(phase,root,reportRoot=root) {
    const {stats,stage,manifest}=await integrationInputs(root);
    const db=await openDatabase(resolve(root,'database'),manifest);
    const report={phase,pid:process.pid,before:await counts(db)};
    try {
        if(phase==='bootstrap') report.muse=await load(db,stats,resolve(reportRoot,'bootstrap-muse.jsonl'),1);
        if(phase==='muse-resume-recco-bootstrap') {
            report.muse=await load(db,stats,resolve(reportRoot,'resume-muse.jsonl'));
            report.reccobeats=await loadReccobeats(db,stage,resolve(reportRoot,'bootstrap-recco.jsonl'),1);
        }
        if(['recco-resume','replay','resume'].includes(phase)) {
            if(phase!=='recco-resume') report.muse=await load(db,stats,resolve(reportRoot,phase+'-muse.jsonl'));
            report.reccobeats=await loadReccobeats(db,stage,resolve(reportRoot,phase+'-recco.jsonl'));
        }
        const full=['recco-resume','replay','resume','verify'].includes(phase);
        if(phase==='verify') {
            report.constraints=await constraintTests(db);
            report.candidates=await candidateAudit(db);
            report.version=(await q(db,'SELECT version() AS v'))[0].v;
        }
        report.audit=await audit(db,full);
        if(full) report.fingerprints=await fingerprints(db);
    } finally { await db.close(); }
    await writeNew(resolve(reportRoot,phase+'.json'),report);
}

async function runWorker(phase,root,reportRoot=root) {
    await new Promise((done,fail)=>{
        const child=spawn(process.execPath,[self,'--worker',phase,root,reportRoot],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        let output=''; child.stdout.on('data',d=>{output+=d;}); child.stderr.on('data',d=>{output+=d;});
        child.on('error',fail); child.on('close',code=>code===0?done():fail(new Error(`${phase}: ${output}`)));
    });
    return JSON.parse(await readFile(resolve(reportRoot,phase+'.json'),'utf8'));
}

async function main() {
    if(process.argv[2]==='--worker') return worker(process.argv[3],process.argv[4],process.argv[5]);
    const finishing=process.argv[2]==='--finish';
    const resuming=process.argv[2]==='--resume' || finishing;
    const root=await localDirectory((resuming?process.argv[3]:process.argv[2])??resolve(music,'.local/music-integrated-20261020-v1'));
    let reportRoot=root;
    if(resuming) {
        assert.ok((await readdir(root)).includes('database'),'Resume requires an existing integration DB');
        if(finishing) {
            reportRoot=resolve(process.argv[4]);
            assert.equal(dirname(reportRoot),resolve(root,'runs'),'Evidence must belong to this integration root');
            const names=await readdir(reportRoot);
            assert.ok(!names.includes('verify.json') && !names.includes('result.json'),'Completed evidence cannot be overwritten');
        } else {
            reportRoot=resolve(root,'runs',randomUUID()); await mkdir(reportRoot,{recursive:true});
        }
    } else assert.deepEqual((await readdir(root)).sort(),['reccobeats-staging'],'Controller requires a NEW integration root with staging only');
    const reports=[];
    if(finishing) for(const phase of ['resume','replay'])
        reports.push(JSON.parse(await readFile(resolve(reportRoot,phase+'.json'),'utf8')));
    for(const phase of (finishing?['verify']:resuming?['resume','replay','verify']:['bootstrap','muse-resume-recco-bootstrap','recco-resume','replay','verify'])) {
        console.log(JSON.stringify({phase,status:'started'}));
        const report=await runWorker(phase,root,reportRoot); reports.push(report);
        console.log(JSON.stringify({phase,status:'PASS',counts:report.audit.counts}));
    }
    let first,second,third,replay,last;
    if(resuming) {
        [third,replay,last]=reports;
        // Preserve original boundary evidence if the earlier controller stopped after its commits.
        try {
            first=JSON.parse(await readFile(resolve(root,'bootstrap.json'),'utf8'));
            second=JSON.parse(await readFile(resolve(root,'muse-resume-recco-bootstrap.json'),'utf8'));
        } catch(error) { if(error.code!=='ENOENT') throw error; }
    } else [first,second,third,replay,last]=reports;
    assert.equal(new Set(reports.map(r=>r.pid)).size,reports.length);
    if(first && second) {
        assert.equal(first.muse.outcome,'interrupted_at_committed_boundary');
        assert.deepEqual(first.audit.counts,{songs:0,song_sources:500,emotion_scores:2000});
        assert.deepEqual(second.before,first.audit.counts);
        assert.equal(second.reccobeats.outcome,'interrupted_at_committed_boundary');
        assert.deepEqual(second.audit.counts,{songs:0,song_sources:90908,emotion_scores:362632});
        if(!resuming) assert.deepEqual(third.before,second.audit.counts);
    }
    assert.deepEqual(replay.before,expected); assert.deepEqual(last.before,expected);
    assert.equal(replay.muse.inserted_sources+replay.reccobeats.inserted_sources,0);
    assert.equal(replay.muse.inserted_scores+replay.reccobeats.inserted_scores,0);
    assert.deepEqual(third.fingerprints,replay.fingerprints); assert.deepEqual(third.fingerprints,last.fingerprints);
    const staging=JSON.parse(await readFile(resolve(root,'reccobeats-staging/manifest.json'),'utf8'));
    for(const [name,sha] of Object.entries(staging.protected_sha256))
        assert.equal(await shaFile(resolve(music,'.local',name)),sha,'Protected input drift');
    const result={result:'PASS',database:resolve(root,'database/pgdata'),engine:last.version,
        counts:expected,providers:last.audit.providers,unique_spotify_candidates:60741,
        reccobeats_coordinate_songs:27948,muse_reccobeats_common_candidates:27948,
        actual_views:last.audit.views,candidate_views:last.candidates,
        real_verified_sources:0,all_real_sources_pending:true,separate_processes:reports.length,
        committed_boundary_evidence_preserved:Boolean(first && second),controller_resumed:resuming,
        resumed_muse_sources:first?.audit.counts.song_sources??null,
        resumed_reccobeats_sources:second?500:null,replay_inserted_sources:0,replay_inserted_scores:0,
        row_fingerprints_unchanged_after_replay_and_reopen:true,constraints:last.constraints,
        load_coordinate_assertions:reports.reduce((n,r)=>n+(r.muse?.checks??0)+(r.reccobeats?.checks??0),0),
        protected_source_files_unchanged:Object.keys(staging.protected_sha256).length,
        external_api_calls:0,external_database_connections:0,
        remaining:'Source-scoped independent review and explicit selection; duplicate MuSe IDs held; provider rights and team API/deployment agreement unresolved.'};
    await writeNew(resolve(reportRoot,'result.json'),result);
    console.log(JSON.stringify({result:'PASS',counts:expected,candidates:expectedCandidates,report:resolve(reportRoot,'result.json')}));
}

if(process.argv[1] && resolve(process.argv[1])===self) await main();

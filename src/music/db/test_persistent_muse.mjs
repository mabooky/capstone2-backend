// Separate-process persistence/replay test. Never opens network database URLs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entries } from './load_muse_batches.mjs';
import { music,trial,views,sourceColumns,inputs,openDatabase,localDirectory,
    load,counts,viewCounts,q,replayQuery } from './persistent_muse.mjs';

const self=fileURLToPath(import.meta.url);
const expected={songs:0,song_sources:90408,emotion_scores:361632};
const emptyViews=Object.fromEntries(views.map(v=>[v,0]));
async function first(name) { for await(const row of entries(resolve(trial,name))) return row; }
async function fingerprints(db) {
    const result={};
    for(const table of ['songs','song_sources','emotion_scores']) {
        const hash=createHash('sha256');
        let after='0',seen=0;
        while(true) {
            const rows=await q(db,`SELECT id::text AS id,md5(to_jsonb(t)::text) AS hash
                FROM music.${table} t WHERE t.id>$1::bigint ORDER BY t.id LIMIT 2000`,[after]);
            for(const row of rows) {
                assert.ok(BigInt(row.id)>BigInt(after),'Fingerprint pagination must use numeric PK order');
                hash.update(row.id+':'+row.hash+'\n');
                after=row.id; seen++;
            }
            if(!rows.length) break;
        }
        assert.equal(seen,(await q(db,`SELECT count(*)::int AS n FROM music.${table}`))[0].n,'Fingerprint must cover every stored row');
        result[table]=hash.digest('hex');
    }
    return result;
}
async function audit(db,full) {
    const count=await counts(db);
    if(full) assert.deepEqual(count,expected);
    assert.deepEqual(await viewCounts(db),emptyViews);
    assert.equal((await q(db,`SELECT count(*)::int AS n FROM music.song_sources
        WHERE provider<>'muse' OR match_status<>'pending' OR song_id IS NOT NULL OR
        verified_at IS NOT NULL OR match_evidence IS NOT NULL OR is_recommendation_source`))[0].n,0);
    assert.equal((await q(db,`SELECT count(*)::int AS n FROM music.emotion_scores e
        LEFT JOIN music.song_sources s ON s.id=e.song_source_id WHERE s.id IS NULL`))[0].n,0);
    assert.equal((await q(db,`SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='music' AND table_type='BASE TABLE'`))[0].n,3);
    const columns=await q(db,`SELECT table_name,count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='music' AND table_name=ANY($1::text[]) GROUP BY table_name ORDER BY table_name`,[views]);
    assert.equal(columns.length,5); assert.ok(columns.every(r=>r.n===14));
    if(full) {
        assert.equal((await q(db,"SELECT count(*)::int AS n FROM music.song_sources WHERE candidate_spotify_id IS NULL"))[0].n,28506);
        assert.equal((await q(db,"SELECT count(DISTINCT candidate_spotify_id)::int AS n FROM music.song_sources"))[0].n,60741);
        assert.deepEqual((await q(db,`SELECT count(*)::int AS groups,sum(n)::int AS rows FROM
            (SELECT count(*) n FROM music.song_sources WHERE candidate_spotify_id IS NOT NULL
             GROUP BY candidate_spotify_id HAVING count(*)>1) x`))[0],{groups:1063,rows:2224});
        assert.equal((await q(db,`SELECT count(*)::int AS n FROM music.song_sources
            WHERE (raw_payload->>'valence_tags')::numeric<1 OR (raw_payload->>'arousal_tags')::numeric<1`))[0].n,333);
    }
    return {counts:count,views:await viewCounts(db),all_sources_pending:true,
        persisted_reccobeats_sources:0,fingerprints:await fingerprints(db)};
}
async function constraints(db) {
    let checks=0;
    const reject=async(sql,args,code,run=q)=>{
        await db.exec('SAVEPOINT rejected_statement');
        try {
            let caught;
            try { await run(db,sql,args); } catch(error) { caught=error; }
            assert.ok(caught,`Expected ${code}`); assert.equal(caught.code,code); checks++;
        } finally { await db.exec('ROLLBACK TO rejected_statement; RELEASE rejected_statement;'); }
    };
    const src=await first('song_sources.jsonl'), score=await first('emotion_scores.jsonl');
    const id=(await q(db,'SELECT id FROM music.song_sources WHERE external_id=$1 AND provider=$2 AND source_version=$3',
        [src.external_id,src.provider,src.source_version]))[0].id;
    await db.exec('BEGIN');
    try {
        await reject(`INSERT INTO music.song_sources(provider,external_id,source_version,source_url,rights_reference)
            SELECT provider,external_id,source_version,source_url,rights_reference FROM music.song_sources WHERE id=$1`,[id],'23505');
        await reject(`INSERT INTO music.song_sources(id,provider,external_id,source_version,source_url,rights_reference)
            OVERRIDING SYSTEM VALUE SELECT id,provider,'pk-probe',source_version,source_url,rights_reference
            FROM music.song_sources WHERE id=$1`,[id],'23505');
        await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES($1,$2,$3,$4)`,[id,score.insert_values.metric,score.insert_values.raw_value,score.insert_values.normalization_version],'23505');
        await reject(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
            VALUES(9223372036854775807,'valence',1,'muse-theoretical-v1')`,[],'23503');
        await reject("UPDATE music.song_sources SET is_recommendation_source=true WHERE id=$1",[id],'23514');
        await reject("UPDATE music.song_sources SET match_status='verified' WHERE id=$1",[id],'23514');
        await reject("UPDATE music.song_sources SET raw_payload='{}'::jsonb WHERE id=$1",[id],'55000');
        await reject("UPDATE music.emotion_scores SET raw_value=raw_value WHERE song_source_id=$1",[id],'55000');
        // Synthetic songs are rolled back; no real source is ever promoted.
        const sid='Z'.repeat(22);
        const song=(await q(db,"INSERT INTO music.songs(spotify_id,title,artist) VALUES($1,'Synthetic','Fixture') RETURNING id",[sid]))[0].id;
        await reject("INSERT INTO music.songs(spotify_id,title,artist) VALUES($1,'Synthetic','Fixture')",[sid],'23505');
        await reject(`INSERT INTO music.song_sources(song_id,provider,external_id,source_version,source_url,
            rights_reference,candidate_spotify_id,match_status,match_evidence,verified_at)
            VALUES($1,'muse','bad-composite-fk','zenodo-4281165-v1.0.0','fixture','fixture',$2,
            'verified','{"method":"fixture","reference":"synthetic-only"}',now())`,[song,'Y'.repeat(22)],'23503');
        const pending=(await q(db,`INSERT INTO music.song_sources(provider,external_id,source_version,source_url,rights_reference)
            VALUES('muse','transaction-rollback-fixture','zenodo-4281165-v1.0.0','fixture','fixture') RETURNING id`))[0].id;
        await q(db,"UPDATE music.song_sources SET match_status='rejected',match_evidence=$2 WHERE id=$1",
            [pending,{method:'fixture',reference:'synthetic-only',reason:'reviewed_wrong_recording'}]);
        await q(db,"UPDATE music.song_sources SET match_status='pending' WHERE id=$1",[pending]); checks++;
        const adapter=replayQuery({inserted_sources:0,inserted_scores:0});
        await reject(`INSERT INTO music.song_sources(${sourceColumns.join(',')})`,
            [JSON.stringify([{...src,raw_payload:{...src.raw_payload,track:'DO NOT OVERWRITE'}}])],'INPUT_CONFLICT',adapter);
        await reject('INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)',
            [JSON.stringify([{song_source_id:id,...score.insert_values,raw_value:'1'}])],'INPUT_CONFLICT',adapter);
    } finally { await db.exec('ROLLBACK'); }
    assert.deepEqual(await counts(db),expected);
    assert.equal((await q(db,"SELECT count(*)::int AS n FROM music.song_sources WHERE external_id='transaction-rollback-fixture'"))[0].n,0);
    return {expected_rejections:checks-1,synthetic_rejected_pending_transition:true,
        whole_transaction_rollback:true,conflicting_replay_rejected:true};
}
async function worker(phase,directory,reportDir) {
    const began=performance.now();
    const {stats,manifest}=await inputs();
    const db=await openDatabase(directory,manifest);
    const report={phase,pid:process.pid,engine:(await q(db,'SELECT version() AS version'))[0].version};
    try {
        report.before=await counts(db);
        if(phase==='bootstrap' && report.before.song_sources>0) {
            report.load={outcome:'existing_database_reopened',checks:0,inserted_sources:0,inserted_scores:0};
        } else if(phase!=='verify') {
            const boundary=phase==='bootstrap' && report.before.song_sources===0 ? 1 : Infinity;
            report.load=await load(db,stats,resolve(reportDir,phase+'-batches.jsonl'),boundary);
            if(phase==='bootstrap' && boundary===1) {
                assert.equal(report.load.outcome,'interrupted_at_committed_boundary');
                assert.deepEqual(await counts(db),{songs:0,song_sources:500,emotion_scores:2000});
            } else assert.equal(report.load.outcome,'completed');
        }
        if(phase==='verify') {
            report.constraints=await constraints(db);
            await assert.rejects(()=>openDatabase(directory,{...manifest,version:'wrong-manifest'}),/manifest mismatch/);
            report.manifest_drift_rejected=true;
        }
        report.audit=await audit(db,phase!=='bootstrap' || report.before.song_sources===expected.song_sources);
    } finally { await db.close(); }
    report.closed=true;
    report.seconds=(performance.now()-began)/1000;
    await writeFile(resolve(reportDir,phase+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
}
async function main() {
    if(process.argv[2]==='--worker') return worker(...process.argv.slice(3));
    const directory=await localDirectory(process.argv[2]??resolve(music,'.local/muse-persistent/stage4-v1'));
    // A controller lock avoids concurrent PGlite processes on the same directory.
    // After a controller crash, inspect processes before manually removing this lock.
    const lockFile=resolve(directory,'run.lock');
    const lock=await open(lockFile,'wx');
    await lock.writeFile(JSON.stringify({pid:process.pid}));
    try {
        const reportDir=resolve(directory,'runs',randomUUID());
        await mkdir(reportDir,{recursive:true});
        const reports=[];
        for(const phase of ['bootstrap','resume','replay','verify']) {
            console.log(JSON.stringify({phase,status:'started'}));
            const result=spawnSync(process.execPath,[self,'--worker',phase,directory,reportDir],
                {encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
            if(result.status!==0) throw new Error(`Phase ${phase} failed: ${result.stderr||result.error||result.stdout}`);
            const report=JSON.parse(await readFile(resolve(reportDir,phase+'.json'),'utf8'));
            reports.push(report);
            console.log(JSON.stringify({phase,status:'PASS',counts:report.audit.counts,seconds:report.seconds}));
        }
        const [bootstrap,resume,replay,verify]=reports;
        assert.equal(new Set(reports.map(r=>r.pid)).size,4,'Must use separate OS processes');
        assert.deepEqual(resume.before,bootstrap.audit.counts);
        assert.deepEqual(replay.before,expected); assert.deepEqual(verify.before,expected);
        assert.deepEqual(replay.audit.fingerprints,resume.audit.fingerprints);
        assert.deepEqual(verify.audit.fingerprints,resume.audit.fingerprints);
        assert.equal(replay.load.inserted_sources,0); assert.equal(replay.load.inserted_scores,0);
        const result={result:'PASS',storage:'filesystem PGlite 0.5.10; PostgreSQL WASM single-process',
            database_directory:resolve(directory,'pgdata'),report_directory:reportDir,
            separate_processes:4,counts:verify.audit.counts,views:verify.audit.views,
            all_sources_pending:true,unique_spotify_candidates:60741,missing_id_rows:28506,
            duplicate_groups:1063,duplicate_rows:2224,below_one_rows:333,
            resumed_from_sources:resume.before.song_sources,replay_inserted_sources:0,replay_inserted_scores:0,
            fingerprints_match_after_reopen:true,constraints:verify.constraints,
            checks:reports.reduce((n,r)=>n+(r.load?.checks??0),0),
            real_sources_promoted:0,persisted_reccobeats_sources:0,external_api_calls:0,external_database_connections:0,
            schema_and_input_manifest:JSON.parse(await readFile(resolve(directory,'schema-manifest.json'),'utf8'))};
        await writeFile(resolve(reportDir,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
        console.log(JSON.stringify({result:'PASS',counts:result.counts,views:result.views,report:resolve(reportDir,'result.json')}));
    } finally { await lock.close(); await unlink(lockFile); }
}
await main();

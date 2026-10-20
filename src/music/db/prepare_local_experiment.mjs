// Build unverified experiment projections ONLY in a new filesystem DB snapshot.
import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { candidateAudit, fingerprints } from './integrate_local_music.mjs';
import { music, openDatabase, q, counts, viewCounts, shaFile, localDirectory } from './persistent_muse.mjs';

const MODELS=['A','B1','B2','C1','C2'];
const N=27948;
const integration=resolve(music,'.local/music-integrated-20261020-v1');
const priorRun=resolve(integration,'runs/333f56bc-995c-41b6-82a7-c6f30b238697');
const newJson=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
async function treeHashes(root) {
    const hashes={};
    async function walk(path) {
        for(const e of (await readdir(path,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
            const p=resolve(path,e.name);
            if(e.isDirectory()) await walk(p);
            else { assert.ok(e.isFile(),'Snapshot input cannot contain links'); hashes[relative(root,p)]=await shaFile(p); }
        }
    }
    await walk(root); return hashes;
}
const idHash=rows=>createHash('sha256').update(rows.map(r=>`${r.song_id}\t${r.spotify_id}\n`).join('')).digest('hex');

async function main() {
    const root=resolve(process.argv[2]??resolve(music,'.local/music-experiment-20261020-v3'));
    const local=resolve(music,'.local');
    assert.ok(relative(local,root) && !relative(local,root).startsWith('..'));
    await mkdir(root,{recursive:false}); await localDirectory(root);
    const prior=JSON.parse(await readFile(resolve(priorRun,'result.json'),'utf8'));
    assert.equal(prior.result,'PASS'); assert.equal(prior.real_verified_sources,0);
    const staging=JSON.parse(await readFile(resolve(integration,'reccobeats-staging/manifest.json'),'utf8'));
    for(const [path,sha] of Object.entries(staging.protected_sha256))
        assert.equal(await shaFile(resolve(local,path)),sha,'Collection input drift');
    const source=resolve(integration,'database'),snapshot=resolve(root,'snapshot');
    const before=await treeHashes(source);
    await cp(source,snapshot,{recursive:true,force:false,errorOnExist:true});
    assert.deepEqual(await treeHashes(snapshot),before,'Snapshot must copy every byte');
    assert.deepEqual(await treeHashes(source),before,'Source changed during snapshot');
    console.log('Snapshot byte audit: PASS');
    const manifest=JSON.parse(await readFile(resolve(snapshot,'schema-manifest.json'),'utf8'));
    const db=await openDatabase(snapshot,manifest);
    let report,artifacts={};
    try {
        await db.exec('SET statement_timeout=60000');
        const baseCounts=await counts(db); assert.deepEqual(baseCounts,prior.counts);
        console.log('Base table counts: PASS');
        const baseFingerprints=JSON.parse(await readFile(resolve(priorRun,'replay.json'),'utf8')).fingerprints;
        assert.deepEqual(await fingerprints(db),baseFingerprints);
        console.log('Base row fingerprints: PASS');
        const structure=await q(db,`SELECT table_schema,table_name FROM information_schema.tables
            WHERE table_type='BASE TABLE' AND table_schema NOT IN ('pg_catalog','information_schema')
            ORDER BY table_schema,table_name`);
        const foreignKeys=await q(db,`SELECT n.nspname AS schema,t.relname AS table_name,c.conname,
            c.convalidated,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c
            JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE c.contype='f' AND n.nspname='music' ORDER BY t.relname,c.conname`);
        assert.equal(foreignKeys.length,3); assert.ok(foreignKeys.every(c=>c.convalidated));
        assert.equal((await q(db,`SELECT count(*)::int n FROM music.emotion_scores e LEFT JOIN music.song_sources s
            ON s.id=e.song_source_id WHERE s.id IS NULL`))[0].n,0);
        assert.equal((await q(db,`SELECT count(*)::int n FROM music.song_sources WHERE
            song_id IS NOT NULL OR match_status<>'pending' OR is_recommendation_source OR verified_at IS NOT NULL`))[0].n,0);
        const providerCounts=await q(db,`SELECT s.provider,count(DISTINCT s.id)::int sources,count(e.id)::int scores
            FROM music.song_sources s JOIN music.emotion_scores e ON e.song_source_id=s.id GROUP BY s.provider ORDER BY s.provider`);
        const actualViews=await viewCounts(db); assert.ok(Object.values(actualViews).every(n=>n===0));
        console.log('Structure, FK and actual VIEW checks: PASS');
        const broadCandidates=await candidateAudit(db);
        console.log('Broad candidate projections: PASS');
        await db.exec(await readFile(new URL('./004_local_experiment.sql',import.meta.url),'utf8'));
        const sourceRows=await q(db,`SELECT id::text,provider,candidate_spotify_id sid,external_id,
            raw_payload->'muse_external_ids' refs FROM music.song_sources WHERE candidate_spotify_id IS NOT NULL`);
        const byProvider={muse:new Map(),reccobeats:new Map()};
        for(const row of sourceRows) {
            const map=byProvider[row.provider]; assert.ok(map);
            const previous=map.get(row.sid)??[]; previous.push(row); map.set(row.sid,previous);
        }
        const mapped=[];
        const sids=[...byProvider.reccobeats.keys()].sort((a,b)=>a<b?-1:a>b?1:0);
        for(const sid of sids) {
            const mr=byProvider.muse.get(sid),rr=byProvider.reccobeats.get(sid);
            if(mr?.length!==1 || rr.length!==1) continue;
            assert.deepEqual(rr[0].refs,[mr[0].external_id]);
            mapped.push({id:String(mapped.length+1),sid,muse:mr[0].id,recco:rr[0].id});
        }
        assert.equal(mapped.length,N);
        await q(db,`INSERT INTO music_experiment.common_songs
            SELECT id,sid,muse,recco FROM jsonb_to_recordset($1::jsonb)
            AS x(id bigint,sid text,muse bigint,recco bigint)`,[JSON.stringify(mapped)]);
        await db.exec('ANALYZE music_experiment.common_songs');
        console.log('Experimental mapping and views: created');
        assert.equal((await q(db,'SELECT count(*)::int n FROM music_experiment.common_songs'))[0].n,N);
        assert.deepEqual((await q(db,`SELECT count(*)::int groups,sum(n)::int rows FROM
            (SELECT count(*) n FROM music.song_sources WHERE provider='muse' AND candidate_spotify_id IS NOT NULL
            GROUP BY candidate_spotify_id HAVING count(*)>1) t`))[0],{groups:1063,rows:2224});
        assert.equal((await q(db,`SELECT count(*)::int n FROM music_experiment.common_songs c
            JOIN music.song_sources m ON m.id=c.muse_source_id JOIN music.song_sources r ON r.id=c.reccobeats_source_id
            WHERE m.provider<>'muse' OR r.provider<>'reccobeats' OR m.candidate_spotify_id<>c.spotify_id
            OR r.candidate_spotify_id<>c.spotify_id OR r.raw_payload->'muse_external_ids'<>jsonb_build_array(m.external_id)`))[0].n,0);
        const common=await q(db,`SELECT experiment_song_id::text AS song_id,spotify_id,muse_source_id::text,
            reccobeats_source_id::text FROM music_experiment.common_songs ORDER BY experiment_song_id`);
        const commonHash=idHash(common);
        const commonFile='common-songs.jsonl';
        await writeFile(resolve(root,commonFile),common.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
        artifacts[commonFile]=await shaFile(resolve(root,commonFile));
        const results={},axes={};
        for(const model of MODELS) {
            const relation='music_experiment.model_'+model.toLowerCase();
            const rows=await q(db,`SELECT song_id::text,spotify_id,valence::text,arousal::text,
                valence_source_id::text,arousal_source_id::text,valence_normalization_version,
                arousal_normalization_version,valence_source_version,arousal_source_version,
                valence_raw_value::text,arousal_raw_value::text,valence_normalization_config,arousal_normalization_config
                FROM ${relation} t ORDER BY t.song_id`);
            assert.equal(rows.length,N); assert.equal(new Set(rows.map(r=>r.song_id)).size,N);
            assert.equal(new Set(rows.map(r=>r.spotify_id)).size,N); assert.equal(idHash(rows),commonHash);
            assert.ok(rows.every(r=>Object.keys(r).length===14 && Object.values(r).every(v=>v!==null)));
            const stats=(await q(db,`SELECT count(*)::int coordinates,
                min(valence)::text v_min,max(valence)::text v_max,min(arousal)::text a_min,max(arousal)::text a_max,
                count(*) FILTER (WHERE valence IS NULL OR arousal IS NULL)::int missing,
                count(*) FILTER (WHERE valence NOT BETWEEN -1 AND 1 OR arousal NOT BETWEEN -1 AND 1)::int outside_range
                FROM ${relation}`))[0];
            assert.equal(stats.missing,0); assert.equal(stats.outside_range,0);
            axes[model]=new Map(rows.map(r=>[r.song_id,[r.valence,r.arousal,r.valence_source_id,r.arousal_source_id]]));
            const name=model+'.jsonl'; await writeFile(resolve(root,name),rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
            artifacts[name]=await shaFile(resolve(root,name));
            results[model]={...stats,duplicate_song_ids:0,duplicate_spotify_ids:0,song_set_sha256:commonHash,file:name};
            console.log(`${model}: ${N} coordinates PASS`);
        }
        for(const [c,b] of [['C1','B1'],['C2','B2']]) for(const [id,row] of axes[c]) {
            assert.equal(row[0],axes.A.get(id)[0]); assert.equal(row[2],axes.A.get(id)[2]);
            assert.equal(row[1],axes[b].get(id)[1]); assert.equal(row[3],axes[b].get(id)[3]);
        }
        // Independent SQL comparison against the immutable source's raw observations.
        const coordinateAudit=(await q(db,`WITH mapped_sources AS (
            SELECT muse_source_id id FROM music_experiment.common_songs
            UNION ALL SELECT reccobeats_source_id id FROM music_experiment.common_songs)
            SELECT count(*)::int scores,
            count(*) FILTER (WHERE e.raw_value IS DISTINCT FROM CASE s.provider WHEN 'reccobeats'
                THEN (s.raw_payload->>e.metric)::numeric ELSE (s.raw_payload->>(e.metric||'_tags'))::numeric END
                OR e.normalized_value IS DISTINCT FROM 2*(e.raw_value-e.raw_min)/(e.raw_max-e.raw_min)-1)::int errors
            FROM mapped_sources m JOIN music.song_sources s ON s.id=m.id
            JOIN music.emotion_scores e ON e.song_source_id=s.id`))[0];
        assert.equal(coordinateAudit.scores,N*6); assert.equal(coordinateAudit.errors,0);
        assert.deepEqual(await counts(db),baseCounts); assert.deepEqual(await viewCounts(db),actualViews);
        assert.deepEqual(await fingerprints(db),baseFingerprints,'Experiment must never change music rows');
        const experimentFks=await q(db,`SELECT c.conname,c.convalidated,pg_get_constraintdef(c.oid) definition
            FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
            WHERE n.nspname='music_experiment' AND c.contype='f' ORDER BY c.conname`);
        assert.equal(experimentFks.length,2); assert.ok(experimentFks.every(c=>c.convalidated));
        report={result:'PASS',dataset_kind:'unverified-local-experiment-v1',dataset_id:basename(root),
            id_namespace:'music_experiment.common_songs',canonical_song_ids:false,verified:false,
            snapshot_database:resolve(snapshot,'pgdata'),base_structure:structure,base_counts:baseCounts,
            providers:providerCounts,foreign_keys:foreignKeys,experiment_foreign_keys:experimentFks,base_score_orphans:0,
            actual_service_views:actualViews,broad_candidate_counts:broadCandidates.counts,
            common_songs:N,experiment_table:'music_experiment.common_songs',models:results,coordinate_audit:coordinateAudit,
            duplicate_muse_groups_excluded:1063,original_music_rows_unchanged:true,real_verified_transitions:0,
            external_api_calls:0,external_database_connections:0,artifacts_sha256:artifacts,
            schema_sha256:await shaFile(new URL('./004_local_experiment.sql',import.meta.url))};
    } finally { await db.close(); }
    assert.deepEqual(await treeHashes(source),before,'Original integrated DB changed');
    for(const [path,sha] of Object.entries(staging.protected_sha256))
        assert.equal(await shaFile(resolve(local,path)),sha,'Protected collection file changed');
    report.original_integrated_files_unchanged=Object.keys(before).length;
    report.protected_collection_files_unchanged=Object.keys(staging.protected_sha256).length;
    await newJson(resolve(root,'manifest.json'),report);
    await newJson(resolve(root,'source-database-sha256.json'),before);
    console.log(JSON.stringify({result:'PASS',common_songs:N,base_counts:report.base_counts,output:root}));
}
await main();

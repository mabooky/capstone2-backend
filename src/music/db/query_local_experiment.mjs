// Opt-in query boundary for a prepared, unverified LOCAL experiment snapshot.
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entries } from './load_muse_batches.mjs';
import { openDatabase, q, music, counts, viewCounts, shaFile } from './persistent_muse.mjs';

const MODELS=['A','B1','B2','C1','C2'];
export async function openLocalExperiment(root,options) {
    if(options?.allowUnverifiedLocalExperiment!==true) throw new TypeError('Explicit local experiment opt-in required');
    root=await realpath(resolve(root));
    const local=await realpath(resolve(music,'.local'));
    const inside=(base,path)=>{const rel=relative(base,path); assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel));};
    inside(local,root);
    const snapshot=await realpath(resolve(root,'snapshot')); inside(root,snapshot);
    const pgdata=await realpath(resolve(snapshot,'pgdata')); inside(snapshot,pgdata);
    const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
    assert.equal(manifest.result,'PASS'); assert.equal(manifest.dataset_kind,'unverified-local-experiment-v1');
    assert.equal(manifest.verified,false); assert.equal(manifest.canonical_song_ids,false);
    assert.equal(manifest.id_namespace,'music_experiment.common_songs');
    assert.equal(await shaFile(new URL('./004_local_experiment.sql',import.meta.url)),manifest.schema_sha256);
    const schema=JSON.parse(await readFile(resolve(snapshot,'schema-manifest.json'),'utf8'));
    const db=await openDatabase(snapshot,schema);
    try { await db.exec('BEGIN READ ONLY'); }
    catch(error) { await db.close(); throw error; }
    return {
        manifest,db,
        async model(model) {
            if(!MODELS.includes(model)) throw new TypeError('Unknown experiment model');
            const rows=await q(db,`SELECT song_id::text,spotify_id,valence::text,arousal::text,
                valence_source_id::text,arousal_source_id::text,valence_normalization_version,
                arousal_normalization_version,valence_source_version,arousal_source_version,
                valence_raw_value::text,arousal_raw_value::text,valence_normalization_config,arousal_normalization_config
                FROM music_experiment.model_${model.toLowerCase()} t ORDER BY t.song_id`);
            assert.equal(rows.length,manifest.common_songs);
            return {dataset_kind:manifest.dataset_kind,dataset_id:manifest.dataset_id,
                id_namespace:manifest.id_namespace,canonical_song_ids:false,verified:false,model,rows};
        },
        async close() { try { await db.exec('ROLLBACK'); } finally { await db.close(); } },
    };
}

async function main(root) {
    await assert.rejects(()=>openLocalExperiment(root,{}),TypeError);
    const experiment=await openLocalExperiment(root,{allowUnverifiedLocalExperiment:true});
    let matched=0;
    try {
        assert.equal((await q(experiment.db,'SHOW transaction_read_only'))[0].transaction_read_only,'on');
        await assert.rejects(()=>experiment.model('SERVICE'),TypeError);
        for(const model of MODELS) {
            const {rows}=await experiment.model(model);
            const name=model+'.jsonl',file=resolve(root,name);
            assert.equal(await shaFile(file),experiment.manifest.artifacts_sha256[name]);
            let i=0;
            for await(const row of entries(file)) { assert.deepEqual(rows[i++],row); matched++; }
            assert.equal(i,27948);
        }
        assert.deepEqual(await counts(experiment.db),experiment.manifest.base_counts);
        assert.ok(Object.values(await viewCounts(experiment.db)).every(n=>n===0));
        assert.equal((await q(experiment.db,"SELECT count(*)::int n FROM music.song_sources WHERE match_status='verified'"))[0].n,0);
    } finally { await experiment.close(); }
    const result={result:'PASS',reopened_persistent_db:true,transaction_read_only:true,
        models:5,rows_matched_to_exports:matched,real_verified_sources:0,actual_service_views_all_zero:true,
        explicit_opt_in_required:true,invalid_model_rejected:true};
    await writeFile(resolve(root,'database-query-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(result));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main(resolve(process.argv[2]));

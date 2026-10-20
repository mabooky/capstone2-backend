// Explicit local-only smoke/guard tests using the unchanged TypeScript algorithm.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { entries } from './load_muse_batches.mjs';
import { shaFile, music } from './persistent_muse.mjs';

const root=resolve(process.argv[2]);
const build=resolve(process.argv[3]??resolve(music,'.local/music-experiment-runtime-20261020-v1/build'));
const {experimentRows}=await import(pathToFileURL(resolve(build,'db/experiment_input.js')).href);
const {compareViews}=await import(pathToFileURL(resolve(build,'algorithm/recommend.js')).href);
const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
assert.equal(manifest.result,'PASS');
const inputs={}; let checks=0;
for(const model of ['A','B1','B2','C1','C2']) {
    const file=resolve(root,model+'.jsonl');
    assert.equal(await shaFile(file),manifest.artifacts_sha256[model+'.jsonl']); checks++;
    const rows=[]; for await(const r of entries(file)) rows.push(r);
    const envelope={dataset_kind:manifest.dataset_kind,dataset_id:manifest.dataset_id,
        id_namespace:manifest.id_namespace,canonical_song_ids:manifest.canonical_song_ids,
        verified:manifest.verified,model,rows};
    inputs[model]=experimentRows(envelope,{allowUnverifiedLocalExperiment:true});
    assert.equal(inputs[model].length,27948); checks++;
    for(const [e,o] of [[envelope,{}],[{...envelope,verified:true},{allowUnverifiedLocalExperiment:true}],
        [{...envelope,canonical_song_ids:true},{allowUnverifiedLocalExperiment:true}],
        [{...envelope,id_namespace:'music.songs'},{allowUnverifiedLocalExperiment:true}]]) {
        assert.throws(()=>experimentRows(e,o),TypeError); checks++;
    }
}
const comparison=compareViews(inputs,{valence:0,arousal:0,limit:10});
assert.equal(comparison.commonSongIds.length,27948); checks++;
for(const model of ['A','B1','B2','C1','C2']) {
    const result=comparison.results[model];
    assert.equal(comparison.coverage[model],27948); assert.equal(result.tracks.length,10);
    assert.equal(result.availableCandidates,27948); assert.equal(result.duplicateRowsIgnored,0); checks+=4;
}
const result={result:'PASS',checks,common_songs:27948,models:5,top_k:10,
    unmodified_algorithm:true,explicit_unverified_opt_in:true,production_repository_used:false,
    scope:'Input/ranking smoke check only; not emotion quality or speed evaluation.'};
await writeFile(resolve(root,'algorithm-input-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));

// Local filesystem PGlite only. No URLs, external connections, or source promotion.
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, realpath, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBatches } from './load_muse_batches.mjs';

const require = createRequire(new URL('../.local/sql-validation/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
export const music = fileURLToPath(new URL('../', import.meta.url));
export const trial = resolve(music, '.local/muse-cleaned/full-90408-v1');
export const sqlFiles = ['001_schema.sql','002_normalization_v1.sql','003_recommendation_views.sql'];
export const views = ['recommend_a','recommend_b1','recommend_b2','recommend_c1','recommend_c2'];
export const sourceColumns = ['song_id','provider','external_id','source_version','fetched_at',
    'source_url','rights_reference','raw_payload','candidate_spotify_id','match_status',
    'match_evidence','verified_at','is_recommendation_source'];
export const q = async (db, sql, args=[]) => (await db.query(sql,args)).rows;
export const key = r => JSON.stringify([r.provider,r.external_id,r.source_version]);
const naturalJoin = 's.provider=i.provider AND s.external_id=i.external_id AND s.source_version=i.source_version';
export async function shaFile(path) {
    const hash=createHash('sha256');
    for await (const part of createReadStream(path)) hash.update(part);
    return hash.digest('hex');
}
export async function localDirectory(path) {
    const local=await realpath(resolve(music,'.local'));
    const resolved=resolve(path);
    const inside=p => { const r=relative(local,p); assert.ok(r && !r.startsWith('..') && !isAbsolute(r),'Must remain under music/.local'); };
    inside(resolved);
    // Check the nearest existing ancestor BEFORE creating directories through junctions.
    let ancestor=resolved;
    while (true) {
        try { const actual=await realpath(ancestor); if(actual!==local) inside(actual); break; }
        catch(error) { if(error.code!=='ENOENT') throw error; ancestor=dirname(ancestor); }
    }
    await mkdir(resolved,{recursive:true});
    inside(await realpath(resolved));
    return resolved;
}
export async function inputs() {
    const stats=JSON.parse(await readFile(resolve(trial,'stats.json'),'utf8'));
    const validation=JSON.parse(await readFile(resolve(trial,'validation.json'),'utf8'));
    assert.equal(validation.result,'PASS');
    for(const [name,hash] of Object.entries(validation.artifacts_sha256))
        assert.equal(await shaFile(resolve(trial,name)),hash,`Input drift: ${name}`);
    assert.equal(await shaFile(resolve(music,'.local/music-muse/zenodo-4281165-v1.0.0/muse_dataset.csv')),stats.source_sha256);
    const sqlHashes=Object.fromEntries(await Promise.all(sqlFiles.map(async name=>[name,await shaFile(new URL(name,import.meta.url))])));
    assert.equal(sqlHashes['002_normalization_v1.sql'],stats.sql_config_sha256);
    const manifest={version:'persistent-muse-v1',engine:'pglite-0.5.10',source_sha256:stats.source_sha256,
        input_sha256:validation.artifacts_sha256,sql_sha256:sqlHashes};
    return {stats,manifest};
}
export async function openDatabase(directory,manifest) {
    directory=await localDirectory(directory);
    const pgdata=await localDirectory(resolve(directory,'pgdata'));
    const manifestFile=resolve(directory,'schema-manifest.json');
    let stored;
    try { stored=JSON.parse(await readFile(manifestFile,'utf8')); }
    catch(error) { if(error.code!=='ENOENT') throw error; }
    if(stored) assert.deepEqual(stored,manifest,'Schema/input manifest mismatch; no migration is applied');
    const db=new PGlite(pgdata);
    try {
        const exists=(await q(db,"SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='music'"))[0].n;
        if(stored) assert.equal(exists,1,'Manifest exists but schema is missing');
        else {
            assert.equal(exists,0,'Unmanifested schema: manual audit required');
            const sql=[];
            for(const file of sqlFiles) {
                let text=await readFile(new URL(file,import.meta.url),'utf8');
                assert.equal((text.match(/^BEGIN;\r?$/gm)||[]).length,1);
                assert.equal((text.match(/^COMMIT;\r?$/gm)||[]).length,1);
                // Reuse SQL bodies unchanged, with one transaction across all three files.
                text=text.replace(/^BEGIN;\r?$/m,'').replace(/^COMMIT;\r?$/m,'');
                sql.push(text);
            }
            await db.exec('BEGIN;\n'+sql.join('\n')+'\nCOMMIT;');
            await writeFile(manifestFile+'.tmp',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
            await rename(manifestFile+'.tmp',manifestFile);
        }
        return db;
    } catch(error) { await db.close(); throw error; }
}
export async function counts(db) {
    const result={};
    for(const table of ['songs','song_sources','emotion_scores'])
        result[table]=(await q(db,`SELECT count(*)::int AS n FROM music.${table}`))[0].n;
    return result;
}
export async function viewCounts(db) {
    const result={};
    for(const view of views) result[view]=(await q(db,`SELECT count(*)::int AS n FROM music.${view}`))[0].n;
    return result;
}
export function invariant(value,message='Input conflicts with stored immutable observation') {
    if(!value) { const error=new Error(message); error.code='INPUT_CONFLICT'; throw error; }
}
export function replayQuery(metrics,stopAfterBatches=Infinity) {
    let batches=0;
    return async (db,sql,args=[]) => {
        if(sql.trimStart().startsWith('INSERT INTO music.song_sources(')) {
            if(++batches>stopAfterBatches) { const e=new Error('Intentional committed-batch boundary'); e.code='BOUNDARY_STOP'; throw e; }
            const incoming='WITH incoming AS (SELECT * FROM jsonb_populate_recordset(NULL::music.song_sources,$1::jsonb)) ';
            const mismatch=sourceColumns.map(c=>`s.${c} IS DISTINCT FROM i.${c}`).join(' OR ');
            invariant((await q(db,incoming+`SELECT count(*)::int AS n FROM incoming i JOIN music.song_sources s ON ${naturalJoin} WHERE ${mismatch}`,args))[0].n===0);
            const inserted=await q(db,incoming+`INSERT INTO music.song_sources(${sourceColumns.join(',')})
                SELECT ${sourceColumns.map(c=>'i.'+c).join(',')} FROM incoming i
                WHERE NOT EXISTS(SELECT 1 FROM music.song_sources s WHERE ${naturalJoin})
                ON CONFLICT(provider,external_id,source_version) DO NOTHING RETURNING id`,args);
            metrics.inserted_sources+=inserted.length;
            return q(db,incoming+`SELECT s.* FROM incoming i JOIN music.song_sources s ON ${naturalJoin}`,args);
        }
        if(sql.trimStart().startsWith('INSERT INTO music.emotion_scores(')) {
            const incoming=`WITH incoming AS (SELECT * FROM jsonb_to_recordset($1::jsonb)
                AS x(song_source_id bigint,metric text,raw_value numeric,normalization_version text)) `;
            const join='e.song_source_id=i.song_source_id AND e.metric=i.metric AND e.normalization_version=i.normalization_version';
            invariant((await q(db,incoming+`SELECT count(*)::int AS n FROM incoming i JOIN music.emotion_scores e ON ${join} WHERE e.raw_value IS DISTINCT FROM i.raw_value`,args))[0].n===0);
            const inserted=await q(db,incoming+`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
                SELECT i.song_source_id,i.metric,i.raw_value,i.normalization_version FROM incoming i
                WHERE NOT EXISTS(SELECT 1 FROM music.emotion_scores e WHERE ${join})
                ON CONFLICT(song_source_id,metric,normalization_version) DO NOTHING RETURNING id`,args);
            metrics.inserted_scores+=inserted.length;
            return inserted;
        }
        return q(db,sql,args);
    };
}
function fraction(text) {
    const m=String(text).match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    assert.ok(m,'Expected finite decimal');
    const scale=(m[3]?.length??0)-Number(m[4]??0);
    let n=BigInt(m[2]+(m[3]??''))*(m[1]==='-'?-1n:1n);
    if(scale<0) n*=10n**BigInt(-scale);
    return [n,scale>0?10n**BigInt(scale):1n];
}
export async function load(db,stats,progressFile,stopAfterBatches=Infinity) {
    let checks=0;
    const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
    const ok=(v,m)=>{assert.ok(v,m);checks++;};
    const exact=(a,b)=>{const [an,ad]=fraction(a),[bn,bd]=fraction(b);eq(an*bd,bn*ad);};
    const close=(a,b)=>{const [an,ad]=fraction(a),[bn,bd]=fraction(b),d=an*bd-bn*ad;ok((d<0n?-d:d)*10n**15n<=ad*bd,'Normalization drift');};
    const metrics={inserted_sources:0,inserted_scores:0};
    try {
        const batches=await loadBatches({db,trial,stats,batchSize:500,ids:new Map(),sourceColumns,key,
            eq,ok,exact,close,q:replayQuery(metrics,stopAfterBatches),progressFile});
        return {outcome:'completed',checks,...metrics,batches};
    } catch(error) {
        if(error.code!=='BOUNDARY_STOP') throw error;
        return {outcome:'interrupted_at_committed_boundary',checks,...metrics};
    }
}

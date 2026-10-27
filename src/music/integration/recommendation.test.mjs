import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { RecommendationRepository } from './repository.ts';
import { RecommendationService, handleRecommendation } from './service.ts';
import { toInternal, toExternal } from './dto.ts';
import { recommend } from '../algorithm/recommend.ts';

import { PGlite } from '@electric-sql/pglite';
const serviceFor = client => new RecommendationService(new RecommendationRepository(client));
const request = (view='A',extra={}) => ({coordinateSpace:'unit-interval-v1',view,valence:0.5,arousal:0.5,...extra});
const views=['A','B1','B2','C1','C2'];
let db;
before(async()=>{
  db = new PGlite(); // All positive fixtures are synthetic and discarded on close.
  for (const file of ['001_schema.sql','002_normalization_v1.sql','003_recommendation_views.sql'])
    await db.exec(await readFile(new URL('../db/'+file,import.meta.url),'utf8'));
  await db.exec('BEGIN');
  try {
    for (let i=1;i<=125;i++) {
      const sid=String(i).padStart(22,'0');
      const song=(await db.query(`INSERT INTO music.songs(spotify_id,title,artist,duration_ms)
        VALUES($1,$2,'Synthetic artist',$3) RETURNING id`,[sid,'Synthetic '+i,i===1?null:200000])).rows[0].id;
      for (const provider of ['muse','reccobeats']) {
        const source=(await db.query(`INSERT INTO music.song_sources(song_id,provider,external_id,
          source_version,source_url,rights_reference,raw_payload,candidate_spotify_id,match_status,
          match_evidence,verified_at,is_recommendation_source)
          VALUES($1,$2,$3,$4,'https://example.invalid/fixture','synthetic only','{"synthetic":true}',
          $5,'verified','{"method":"synthetic-fixture","reference":"memory-only"}',now(),true) RETURNING id`,
          [song,provider,provider==='muse'?'synthetic-mu-'+i:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),
            provider==='muse'?'zenodo-4281165-v1.0.0':'synthetic-only',sid])).rows[0].id;
        const raw=provider==='muse' ? [i===1?4.5:1+7*i/126,i===1?4.5:1+6*i/126] :
          i===1?[0.5,0.5]:i===2?[0,1]:i===3?[1,0]:[i/130,1-i/130];
        for(const version of provider==='muse'?['muse-theoretical-v1','muse-observed-v1']:['reccobeats-v1']) {
          for (const [metric,value] of [['valence',raw[0]],[provider==='muse'?'arousal':'energy',raw[1]]])
            await db.query(`INSERT INTO music.emotion_scores(song_source_id,metric,raw_value,normalization_version)
              VALUES($1,$2,$3,$4)`,[source,metric,String(value),version]);
        }
      }
    }
    // Existing canonical candidate, but separate pending observations: never visible.
    await db.query(`INSERT INTO music.song_sources(provider,external_id,source_version,source_url,
      rights_reference,candidate_spotify_id) VALUES('muse','pending-duplicate-1','zenodo-4281165-v1.0.0',
      'fixture','synthetic',$1),('muse','pending-duplicate-2','zenodo-4281165-v1.0.0','fixture','synthetic',$1)`,
      ['1'.padStart(22,'0')]);
    await db.exec('COMMIT');
  } catch (error) { await db.exec('ROLLBACK'); throw error; }
});
after(async()=>{await db?.close();});

test('all five real SQL VIEWs feed the unchanged algorithm and draft DTO',async()=>{
  for(const view of views) {
    const repository=new RecommendationRepository(db);
    const snapshot=await repository.read(view);
    assert.equal(snapshot.rows.length,125);
    assert.equal(Object.keys(snapshot.rows[0]).length,14);
    const expected=recommend(snapshot.rows,{view,valence:0,arousal:0,limit:100});
    const result=await new RecommendationService(repository).recommend(request(view));
    assert.equal(result.returnedCount,100);
    assert.deepEqual(result.tracks.map(t=>t.songId),expected.tracks.map(t=>String(t.row.song_id)));
    assert.ok(result.tracks.every(t=>t.valence>=0 && t.valence<=1 && t.arousal>=0 && t.arousal<=1));
    assert.equal(result.coordinateSpace,'unit-interval-v1');
    assert.doesNotThrow(()=>JSON.stringify(result));
  }
});
test('unit conversion has exact endpoints/midpoint, no guessing or clamping',()=>{
  for(const [external,internal] of [[0,-1],[0.5,0],[1,1]]) {
    assert.equal(toInternal(external),internal); assert.equal(toExternal(internal),external);
  }
  for(const value of [null,'0.5',false,NaN,Infinity,-0.01,1.01]) assert.throws(()=>toInternal(value));
  for(const value of [NaN,Infinity,-1.01,1.01]) assert.throws(()=>toExternal(value));
});
test('SQL endpoint tracks retain 0/1 after round trip; nearest track is first',async()=>{
  for(const [valence,arousal,id] of [[0,1,'2'],[1,0,'3']]) {
    const r=await serviceFor(db).recommend(request('A',{valence,arousal,limit:1}));
    assert.equal(r.tracks[0].songId,id); assert.equal(r.tracks[0].valence,valence); assert.equal(r.tracks[0].arousal,arousal);
  }
  const middle=await serviceFor(db).recommend(request('B1',{limit:1}));
  assert.equal(middle.tracks[0].songId,'1'); assert.equal(middle.tracks[0].valence,0.5);
});
test('metadata uses canonical songs, explicit ms, null image and optional Recco ID',async()=>{
  const r=await serviceFor(db).recommend(request('A',{limit:1}));
  assert.equal(r.tracks[0].title,'Synthetic 1'); assert.equal(r.tracks[0].durationMs,null);
  assert.equal(r.tracks[0].albumImageUrl,null); assert.equal(r.tracks[0].reccobeatsId,'00000000-0000-4000-8000-000000000001');
  assert.equal('requestStatus' in r.tracks[0],false);
  assert.equal('raw_value' in r.tracks[0],false);
});
test('MuSe-only candidate remains eligible and Recco ID stays null',async()=>{
  await db.exec('BEGIN');
  try {
    await db.query("UPDATE music.song_sources SET is_recommendation_source=false WHERE provider='reccobeats' AND song_id=1");
    const r=await serviceFor(db).recommend(request('B1',{limit:1}));
    assert.equal(r.tracks[0].songId,'1'); assert.equal(r.tracks[0].reccobeatsId,null);
  } finally {await db.exec('ROLLBACK');}
});
test('client and server exclusions are combined, deduplicated and parameterized',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{calls.push({sql,args});return db.query(sql,args);}};
  const r=await serviceFor(client).recommend(request('A',{excludeSongIds:['1','1']}),{excludeSongIds:['2','1']});
  assert.ok(r.tracks.every(t=>t.songId!=='1' && t.songId!=='2'));
  assert.equal(calls.length,1); assert.deepEqual(calls[0].args,[['1','2']]);
  assert.ok(calls[0].sql.includes('ANY($1::bigint[])')); assert.ok(!calls[0].sql.includes('LIMIT'));
});
test('limit zero avoids querying and all excluded returns a normal empty result',async()=>{
  const zero=await serviceFor({query:()=>{throw Error('Must not query');}}).recommend(request('A',{limit:0}));
  assert.deepEqual(zero.tracks,[]); assert.equal(zero.reason,'zero-limit');
  const empty=await serviceFor(db).recommend(request('A',{excludeSongIds:Array.from({length:125},(_,i)=>String(i+1))}));
  assert.equal(empty.returnedCount,0); assert.equal(empty.reason,'no-candidates');
});
test('shortages return actual tracks without padding',async()=>{
  const r=await serviceFor(db).recommend(request('A',{excludeSongIds:Array.from({length:123},(_,i)=>String(i+1))}));
  assert.equal(r.returnedCount,2); assert.equal(r.reason,'radius-cap-reached');
});
async function rawRows(view='A') {
  let rows;
  await new RecommendationRepository({query:async(sql,args)=>{const result=await db.query(sql,args);rows=result.rows;return result;}}).read(view);
  return rows;
}
test('identical duplicate rows collapse without changing observations',async()=>{
  const rows=(await rawRows()).slice(0,3);
  const before=JSON.stringify(rows);
  const r=await serviceFor({query:async()=>({rows:[...rows,rows[0],rows[0]]})}).recommend(request());
  assert.equal(r.returnedCount,3); assert.equal(new Set(r.tracks.map(t=>t.songId)).size,3);
  assert.equal(JSON.stringify(rows),before);
});
test('conflicting coordinates and conflicting display metadata fail closed',async()=>{
  const [row]=await rawRows();
  for(const changed of [{...row,valence:'0.8'},{...row,catalog_title:'Conflicting'}]) {
    const response=await handleRecommendation(serviceFor({query:async()=>({rows:[row,changed]})}),request());
    assert.equal(response.status,500); assert.equal(response.body.error.code,'RECOMMENDATION_FAILED');
  }
});
test('malformed or mixed-version rows never become empty successful results',async()=>{
  const [row]=await rawRows();
  for(const change of [{valence:null},{valence:'1.0000000000000000000000000001'},
      {valence_normalization_version:'muse-theoretical-v1'}, {catalog_duration_ms:-1},
      {song_id:'900719925474099300000'},{valence_normalization_config:'not-json'}]) {
    const response=await handleRecommendation(serviceFor({query:async()=>({rows:[{...row,...change}]})}),request());
    assert.equal(response.status,500);
  }
});
test('JSONB string decoding and bigint ID strings preserve JSON precision',async()=>{
  const [row]=await rawRows();
  const source={...row,song_id:'9007199254740993',
    valence_normalization_config:JSON.stringify(row.valence_normalization_config),
    arousal_normalization_config:JSON.stringify(row.arousal_normalization_config)};
  const r=await serviceFor({query:async()=>({rows:[source]})}).recommend(request());
  assert.equal(r.tracks[0].songId,'9007199254740993'); assert.doesNotThrow(()=>JSON.stringify(r));
});
test('invalid DTO and SQL injection attempts fail before any database call',async()=>{
  let calls=0;
  const service=serviceFor({query:async()=>{calls++;throw Error('Do not query');}});
  for(const body of [null,[],{},request('A;DROP SCHEMA music'),request('toString'),request('A',{valence:'0.5'}),
      request('A',{arousal:-1}),request('A',{limit:101}),request('A',{limit:1.5}),
      request('A',{coordinateSpace:'signed-unit-v1'}),request('A',{extra:'unexpected'}),
      request('A',{excludeSongIds:['1);DROP TABLE music.songs;--']}),
      request('A',{excludeSongIds:['9223372036854775808']}),request('A',{excludeSongIds:[1]})]) {
    assert.equal((await handleRecommendation(service,body)).status,400);
  }
  assert.equal(calls,0);
});
test('database errors return sanitized 503 rather than a fabricated empty list',async()=>{
  const response=await handleRecommendation(serviceFor({query:async()=>{throw Error('secret-dsn-and-sql');}}),request());
  assert.equal(response.status,503); assert.equal(response.body.error.code,'DATABASE_UNAVAILABLE');
  assert.ok(!JSON.stringify(response).includes('secret-dsn'));
});
test('HTTP bridge returns DTO 200 and treats broken server context as 500',async()=>{
  const response=await handleRecommendation(serviceFor(db),request('B1',{limit:3}));
  assert.equal(response.status,200); assert.equal(response.body.returnedCount,3);
  let called=false;
  const failure=await handleRecommendation(serviceFor({query:async()=>{called=true;return {rows:[]};}}),
    request(),{excludeSongIds:['invalid-server-id']});
  assert.equal(failure.status,500); assert.equal(called,false);
});
test('repository itself enforces the VIEW allowlist',async()=>{
  let calls=0;
  const repository=new RecommendationRepository({query:async()=>{calls++;return {rows:[]};}});
  await assert.rejects(()=>repository.read('recommend_a;DELETE'));
  assert.equal(calls,0);
});
test('pending duplicate source rows are not visible through any VIEW',async()=>{
  for(const view of views) assert.equal((await new RecommendationRepository(db).read(view)).rows.length,125);
  assert.equal((await db.query("SELECT count(*)::int n FROM music.song_sources WHERE match_status='pending'")).rows[0].n,2);
});

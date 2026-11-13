import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTrackLibraryFrom } from './tracks/trackLibrary.js';
import { Store } from './store.js';
import { hashPassword } from './auth/password.js';
import { storeRouter } from './routes/storeRouter.js';
import { resolveStore, errorHandler } from './middleware.js';

const id = n => String(n).padStart(22, '0');
const row = (n, v, e) => ({spotify_id:id(n),title:`Track ${n}`,artist:'Artist',duration_ms:1000,valence:v,energy:e});
const rows = [row(1,.5,.5),row(2,.6,.5),row(3,.5,.6),row(4,.55,.55),row(5,1,1)];
const range = {mode:'range',valenceMin:-.1,valenceMax:.3,energyMin:-.1,energyMax:.3,n:100};
const seedRequest = {mode:'seeds',spotifyIds:[id(1),id(2),id(3)],n:4};
const adminPasswordHash = await hashPassword('synthetic-test');
const makeStore = (storeId = 'test') => new Store(createTrackLibraryFrom(rows), {id:storeId,name:'Test',adminPasswordHash,trackCooldownMs:1000,now:()=>500,random:()=>.25});

test('tracks_v3 row mapping normalizes model A exactly once, never converts missing coordinates to -1', () => {
    const source = [row(1,0,1),row(2,.5,.5),row(3,null,.5),row(4,'',.5),row(5,1.1,.5),row(6,'0.75','0.25')];
    const library = createTrackLibraryFrom(source);
    assert.equal(library.get(id(1)).valence,-1);
    assert.equal(library.get(id(1)).arousal,1);
    assert.equal(library.get(id(2)).valence,0);
    const result = library.recommend({...range,valenceMin:-1,valenceMax:1,energyMin:-1,energyMax:1});
    assert.deepEqual(result.tracks.map(t=>t.spotifyId).sort(),[1,2,6].map(id));
    assert.equal(library.get(id(6)).valence,.5);
    assert.equal(source[0].valence,0);
});
test('Store catalog update preserves queue, playback, cooldown, admin token; failed input is atomic', () => {
    const store = makeStore();
    const token = store.issueAdminToken();
    store.setRegionCatalog(range);
    store.enqueue('client-a',id(1));
    store.reportNowPlaying(id(1));
    store.enqueue('client-b',id(2));
    const previous = store.getState('client-b');
    const preview = store.getRegionPreview(seedRequest);
    assert.equal(preview.tracks.length,4);
    assert.deepEqual(store.getState('client-b'),previous);
    store.setRegionCatalog({...range,valenceMin:.9,valenceMax:1,energyMin:.9,energyMax:1});
    const next = store.getState('client-b');
    assert.deepEqual(next.nowPlaying,previous.nowPlaying);
    assert.deepEqual(next.queue,previous.queue);
    assert.notEqual(next.catalogHash,previous.catalogHash);
    assert.ok(store.isAdminToken(token));
    assert.equal(store.reportNowPlaying(id(2)).source,'request');
    store.setRegionCatalog(range);
    assert.equal(store.getCatalog().find(t=>t.spotifyId===id(1)).requestStatus,'recently-played');
    const beforeFailure = store.getState();
    assert.throws(()=>store.setRegionCatalog({...seedRequest,spotifyIds:[id(1),id(2),id(99)]}));
    assert.deepEqual(store.getState(),beforeFailure);
    assert.equal(store.getRegion().mode,'range');
    const copy = store.getRegion(); copy.n=1;
    assert.equal(store.getRegion().n,100);
});
test('empty catalog retains hash and NO_TRACKS behavior, excludes out-of-catalog requests', () => {
    const store = makeStore();
    const result = store.setRegionCatalog({...range,valenceMin:-1,valenceMax:-.9,energyMin:-1,energyMax:-.9});
    assert.equal(result.status,'empty');
    assert.deepEqual(store.getCatalog(),[]);
    assert.throws(()=>store.getFallbackTrack(),error=>error.code==='NO_TRACKS');
    assert.throws(()=>store.enqueue('client',id(1)),error=>error.code==='OUT_OF_MOOD');
});
test('real production routers: login, catalog, request, state, playback, isolation on synthetic memory library', async t => {
    const store = makeStore('one'), other = makeStore('two');
    const app = express(); app.use(express.json());
    app.use('/api/stores/:storeId',resolveStore([store,other]),storeRouter);
    app.use(errorHandler);
    const server = app.listen(0,'127.0.0.1');
    await new Promise(resolve=>server.once('listening',resolve));
    t.after(()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
    const base = `http://127.0.0.1:${server.address().port}/api/stores`;
    const request = async (path,method='GET',body,token) => {
        const response = await fetch(`${base}/${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {})},body:body===undefined?undefined:JSON.stringify(body)});
        return {status:response.status,body:response.status===204?null:await response.json()};
    };
    assert.equal((await request('missing/catalog')).status,404);
    assert.equal((await request('one/admin/fallback-track')).status,401);
    assert.equal((await request('one/admin/mood','PUT',seedRequest)).status,401);
    assert.equal((await request('one/admin/mood/preview?mode=range')).status,401);
    const login = await request('one/admin/login','POST',{password:'synthetic-test'});
    assert.equal(login.status,200);
    const token=login.body.token;
    assert.equal((await request('two/admin/mood','PUT',seedRequest,token)).status,401);
    const generated=await request('one/admin/mood','PUT',seedRequest,token);
    assert.equal(generated.status,200);
    assert.equal(generated.body.status,'complete');
    assert.equal(generated.body.tracks.length,4);
    assert.equal(generated.body.candidateCount,4);
    assert.ok(generated.body.tracks.every(t=>t.requestStatus==='available'));
    for(const key of seedRequest.spotifyIds) assert.ok(generated.body.tracks.some(t=>t.spotifyId===key));
    assert.deepEqual((await request('one/mood')).body.region,seedRequest);
    const catalog = await request('one/catalog');
    assert.equal(catalog.body.length,4);
    assert.deepEqual(catalog.body,generated.body.tracks);
    assert.ok(catalog.body.every(t=>t.requestStatus==='available'));
    const otherBefore = (await request('two/state')).body;
    // 신청과 내 상태 조회는 로그인 세션(DB)이 필요하므로 HTTP가 아니라 Store를 직접 호출합니다.
    store.enqueue('a',id(1));
    assert.throws(()=>store.enqueue('b',id(1)),error=>error.status===409);
    assert.equal(store.getMe('a').canRequest,false);
    assert.equal(store.getState('a').queue[0].mine,true);
    assert.equal((await request('one/admin/now-playing','PUT',{spotifyId:id(1)},token)).body.nowPlaying.source,'request');
    assert.equal(store.getMe('a').canRequest,true);
    store.enqueue('b',id(2));
    const before=(await request('one/state')).body;
    const query=new URLSearchParams({mode:'seeds',n:'4'});
    for(const key of seedRequest.spotifyIds) query.append('spotifyIds',key);
    const preview=await request(`one/admin/mood/preview?${query}`,'GET',undefined,token);
    assert.equal(preview.status,200);
    assert.equal(preview.body.status,'complete');
    assert.equal(preview.body.tracks.length,4);
    assert.ok(preview.body.tracks.every(t=>!('requestStatus' in t)));
    assert.deepEqual((await request('one/state')).body,before);
    const rangePreview=new URLSearchParams({...range});
    assert.equal((await request(`one/admin/mood/preview?${rangePreview}`,'GET',undefined,token)).body.status,'insufficient-candidates');
    for(const body of [{...seedRequest,n:2},{...seedRequest,spotifyIds:[id(1),id(2),id(99)]},
        {...range,view:'B1'},{...range,mode:'B1'}, {...range,n:'4'}, {...range,valenceMin:.5,valenceMax:0},
        {...seedRequest,spotifyIds:[id(1),id(1),id(2)]}, {...range,mode:null}, {...range,energyMin:2}]) {
        const bad=await request('one/admin/mood','PUT',body,token);
        assert.equal(bad.status,400);
        assert.equal(bad.body.error.code,'INVALID_INPUT');
        assert.deepEqual((await request('one/state')).body,before);
        assert.deepEqual((await request('one/mood')).body.region,seedRequest);
    }
    for(const suffix of ['mode=range&n=2&valenceMin=0&valenceMax=1&energyMin=0&energyMax=1&view=C1',
        'mode=seeds&n=4&spotifyIds=bad', 'mode=unknown&n=2',
        'mode=range&n=2&n=3&valenceMin=0&valenceMax=1&energyMin=0&energyMax=1']) {
        assert.equal((await request(`one/admin/mood/preview?${suffix}`,'GET',undefined,token)).status,400);
    }
    const shortage=await request('one/admin/mood','PUT',range,token);
    assert.equal(shortage.body.status,'insufficient-candidates');
    assert.equal(shortage.body.tracks.length,4);
    assert.deepEqual((await request('one/state')).body.queue,before.queue);
    assert.deepEqual((await request('one/state')).body.nowPlaying,before.nowPlaying);
    const emptyRequest={...range,valenceMin:-1,valenceMax:-.9,energyMin:-1,energyMax:-.9};
    const empty=await request('one/admin/mood','PUT',emptyRequest,token);
    assert.deepEqual(empty.body,{tracks:[],status:'empty',candidateCount:0});
    assert.deepEqual((await request('one/catalog')).body,[]);
    assert.notEqual((await request('one/state')).body.catalogHash,before.catalogHash);
    assert.deepEqual((await request('one/mood')).body.region,emptyRequest);
    const afterEmpty=(await request('one/state')).body;
    const modeless=await request('one/admin/mood','PUT',{valence:0,arousal:0,n:2},token);
    assert.equal(modeless.status,400);
    assert.equal(modeless.body.error.code,'INVALID_INPUT');
    assert.equal((await request('one/admin/mood/preview?valence=0&arousal=0&n=2','GET',undefined,token)).status,400);
    assert.deepEqual((await request('one/state')).body,afterEmpty);
    assert.deepEqual((await request('one/mood')).body.region,emptyRequest);
    assert.deepEqual((await request('two/state')).body,otherBefore);
});

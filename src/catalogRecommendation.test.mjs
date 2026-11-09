import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendCatalog, parseCatalogRequest } from './catalogRecommendation.js';

const id = n => String(n).padStart(22, '0');
const track = (n, x, y) => ({ spotifyId: id(n), valence: x, arousal: y, title: `track ${n}`, artist: 'artist', duration: 1000, albumImageUrl: '' });
const seeds = (n = 100) => ({ mode: 'seeds', spotifyIds: [id(1), id(2), id(3)], n });
const range = (n = 100) => ({ mode: 'range', valenceMin: -1, valenceMax: 1, energyMin: -1, energyMax: 1, n });
const ids = result => result.tracks.map(t => t.spotifyId).sort();

test('convex hull includes interior, edges, circular buffer and rounded vertices; excludes outside', () => {
    const library = [track(1, 0, 0), track(2, .5, 0), track(3, 0, .5), track(4, .1, .1),
        track(5, .25, .25), track(6, .25, -.1), track(7, .25, -.10001),
        track(8, -.06, -.08), track(9, -.08, -.08), track(10, .5, .5)];
    assert.deepEqual(ids(recommendCatalog(library, seeds())), [1,2,3,4,5,6,8].map(id).sort());
});
test('unsorted seeds form convex hull independent of seed order and retain interior seeds', () => {
    const library = [track(1, .5, .5), track(2, -.5, -.5), track(3, .5, -.5), track(4, -.5, .5), track(5, 0, 0)];
    assert.equal(recommendCatalog(library, {mode:'seeds', spotifyIds:[id(1),id(2),id(5),id(4),id(3)], n:5}).returnedCount, 5);
});
test('collinear seeds yield capsule including endpoint caps', () => {
    const library = [track(1, -.5, 0), track(2, 0, 0), track(3, .5, 0), track(4, .6, 0),
        track(5, -.5, .1), track(6, .58, .08), track(7, 0, .10001)];
    assert.deepEqual(ids(recommendCatalog(library, seeds())), [1,2,3,4,5].map(id));
});
test('identical seed coordinates yield disk; distinct IDs are distinct songs', () => {
    const library = [track(1, 0, 0), track(2, 0, 0), track(3, 0, 0), track(4, .06, .08), track(5, .08, .08)];
    assert.deepEqual(ids(recommendCatalog(library, seeds())), [1,2,3,4].map(id));
});
test('range includes all boundaries, has no buffer, accepts zero-width ranges', () => {
    const library = [track(1, -.5, -.2),track(2, .5, .2),track(3, 0, 0),track(4, .50001, 0),track(5, 0, -.20001)];
    const request = {mode:'range', valenceMin:-.5, valenceMax:.5, energyMin:-.2, energyMax:.2, n:100};
    assert.deepEqual(ids(recommendCatalog(library, request)), [1,2,3].map(id));
    assert.deepEqual(ids(recommendCatalog(library, {...request, valenceMin:0, valenceMax:0, energyMin:0, energyMax:0})), [id(3)]);
});
test('invalid coordinates and out-of-space songs are excluded, IDs deduplicated', () => {
    const library = [track(1, 0, 0),track(1, 0, 0),track(2, NaN, 0),track(3, 0, Infinity),
        track(4, 1.01, 0),track(5, 0, -1.01),track(6, null, 0),track(7, 0, 0)];
    const result = recommendCatalog(library, range());
    assert.deepEqual(ids(result), [id(1),id(7)]);
    assert.equal(result.candidateCount, 2);
    assert.equal(result.status, 'insufficient-candidates');
});
test('all seeds mandatory before sampling, full output shuffled, inputs untouched', () => {
    const library = Array.from({length:20}, (_,i) => track(i+1, 0, 0));
    const snapshot = structuredClone(library);
    const result = recommendCatalog(library, seeds(5), () => 0);
    for (const key of [id(1),id(2),id(3)]) assert.ok(ids(result).includes(key));
    assert.equal(new Set(ids(result)).size, 5);
    assert.notEqual(result.tracks[0].spotifyId, id(1));
    assert.equal(result.status, 'complete');
    assert.deepEqual(library, snapshot);
});
test('empty and shortage are distinguishable, and seed count equal to n works', () => {
    assert.deepEqual(recommendCatalog([], range(1)), {tracks:[],status:'empty',candidateCount:0,returnedCount:0});
    assert.equal(recommendCatalog([track(1,0,0)], range(2)).status, 'insufficient-candidates');
    assert.equal(recommendCatalog([track(1,0,0),track(2,0,0),track(3,0,0)], seeds(3)).returnedCount,3);
});
test('request validation: size, finite bounds, reversed bounds, IDs, seeds, extra fields', () => {
    for (const n of [0,101,1.5,NaN,Infinity,'3',undefined]) assert.throws(() => parseCatalogRequest({...range(),n}), /n은/);
    for (const patch of [{valenceMin:NaN},{energyMax:Infinity},{valenceMax:2},{energyMin:.5,energyMax:0}, {energyMin:null}])
        assert.throws(() => parseCatalogRequest({...range(), ...patch}));
    for (const request of [seeds(2), {...seeds(),spotifyIds:[id(1),id(1),id(2)]}, {...seeds(),spotifyIds:['bad',id(2),id(3)]}, {...range(),view:'B1'}, null])
        assert.throws(() => parseCatalogRequest(request));
    assert.throws(() => recommendCatalog([track(1,0,0),track(2,0,0)], seeds()));
    assert.throws(() => recommendCatalog([track(1,0,0),track(2,0,0),track(3,NaN,0)], seeds()));
    assert.equal(parseCatalogRequest({...seeds(3),spotifyIds:[id(1),id(2),id(3),id(1)]}).spotifyIds.length,3);
});
test('exhaustive Fisher-Yates branches give each ordered pair equal multiplicity', () => {
    const library = [track(1,0,0),track(2,0,0),track(3,0,0)];
    const counts = new Map();
    for (let a=0;a<3;a++) for (let b=0;b<2;b++) for(let c=0;c<2;c++) {
        const stream = [(a+.5)/3,(b+.5)/2,(c+.5)/2];
        const key = recommendCatalog(library, range(2), () => stream.shift()).tracks.map(t=>t.spotifyId).join(',');
        counts.set(key,(counts.get(key)??0)+1);
    }
    assert.equal(counts.size,6);
    assert.deepEqual([...counts.values()],Array(6).fill(2));
});
test('remaining candidates uniformly sampled with seeds fixed as a set', () => {
    const library = Array.from({length:6}, (_,i)=>track(i+1,0,0));
    const counts = new Map();
    for(let a=0;a<3;a++) for(let b=0;b<2;b++) {
        const stream = [(a+.5)/3,(b+.5)/2];
        const result = recommendCatalog(library,seeds(4),()=>stream.shift()??.5);
        const selected = result.tracks.find(t=>Number(t.spotifyId)>3).spotifyId;
        counts.set(selected,(counts.get(selected)??0)+1);
    }
    assert.deepEqual([...counts.values()], [2,2,2]);
});
test('buffered square grid agrees with independent distance-to-box oracle', () => {
    const corners = [track(1,-.3,-.3),track(2,.3,-.3),track(3,.3,.3),track(4,-.3,.3)];
    for(let x=-10;x<=10;x++) for(let y=-10;y<=10;y++) {
        const p=track(5,x/10,y/10);
        const expected=Math.hypot(Math.max(Math.abs(p.valence)-.3,0),Math.max(Math.abs(p.arousal)-.3,0))<=.1+1e-12;
        const result=recommendCatalog([...corners,p],{mode:'seeds',spotifyIds:corners.map(t=>t.spotifyId),n:5});
        assert.equal(result.tracks.some(t=>t.spotifyId===id(5)),expected,`${x},${y}`);
    }
});
test('diagonal capsule uses perpendicular distance and clipped domain', () => {
    const library=[track(1,-.5,-.5),track(2,0,0),track(3,.5,.5),track(4,.05,-.05),track(5,.08,-.08),track(6,1.01,1.01)];
    assert.deepEqual(ids(recommendCatalog(library,seeds())),[1,2,3,4].map(id));
});

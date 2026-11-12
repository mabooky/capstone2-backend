import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackLibraryFrom } from './trackLibrary.js';

const id = n => String(n).padStart(22, '0');
const row = (n, title, valence = .5, energy = .5) => ({
    spotify_id: id(n), title, artist: 'Artist', duration_ms: 1000, valence, energy,
});
const range = {mode:'range', valenceMin:-1, valenceMax:1, energyMin:-1, energyMax:1, n:100};

test('recommendation keeps first valid duplicate, lookup keeps last row, search keeps all rows', () => {
    const rows = [row(2, 'Second'), row(1, 'Invalid first', null), row(1, 'First valid'),
        row(1, 'Later valid', .9), row(1, 'Invalid last', ''), row(3, 'Third'),
        row(4, 'Out of bounds', 2), row(5, 'Missing energy', .5, null)];
    const snapshot = structuredClone(rows);
    const library = createTrackLibraryFrom(rows);
    const first = library.recommend(range, () => .25);
    assert.equal(first.candidateCount, 3);
    assert.equal(first.status, 'insufficient-candidates');
    assert.deepEqual(first.tracks.map(t => t.spotifyId).sort(), [1,2,3].map(id));
    assert.equal(first.tracks.find(t => t.spotifyId === id(1)).title, 'First valid');
    assert.equal(library.get(id(1)).title, 'Invalid last');
    assert.ok(Number.isNaN(library.get(id(1)).valence));
    assert.equal(library.size, rows.length);
    assert.deepEqual(library.search('artist', 100, 0).tracks.map(t => t.title),
        ['Invalid first', 'First valid', 'Later valid', 'Invalid last', 'Second', 'Third', 'Out of bounds', 'Missing energy']);
    assert.equal(library.search('first', 1, 0).tracks[0].title, 'First valid');
    assert.equal(library.search('first', 1, 1).tracks[0].title, 'Invalid first');
    assert.equal(library.search('', 100, 0).total, 0);
    const seeds = {mode:'seeds', spotifyIds:[id(1),id(2),id(3)], n:3};
    assert.equal(library.recommend(seeds, () => .25).tracks.find(t => t.spotifyId === id(1)).title, 'First valid');
    assert.throws(() => library.recommend({...seeds, spotifyIds:[id(1),id(2),id(4)]}), /기준곡/);
    assert.deepEqual(library.recommend(range, () => .25), first);
    assert.deepEqual(rows, snapshot);
});

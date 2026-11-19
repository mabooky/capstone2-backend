import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrackLibraryFrom } from './trackLibrary.js';

const id = n => String(n).padStart(22, '0');
const row = (n, title, valence = .5, arousal = .5) => ({
    spotify_id: id(n), title, artist: 'Artist', artist_spotify_ids: [id(0)], duration_ms: 1000,
    play_count: '0', album_id: id(0), album_thumb_url: null, valence, arousal,
});
const range = {mode:'range', valenceMin:-1, valenceMax:1, energyMin:-1, energyMax:1, n:100};

test('곡 조회, 검색, 추천이 ID순으로 쌓은 곡 목록에서 동작하고 입력은 바뀌지 않습니다', () => {
    // 3번 곡의 제목이 검색어로 시작하고, 1번 곡의 제목은 검색어를 포함하기만 합니다. 4번 곡은 범위 밖입니다.
    const rows = [row(2, 'Second song'), row(1, 'Not first'), row(3, 'First song'), row(4, 'Out of bounds', 2)];
    const snapshot = structuredClone(rows);
    const library = createTrackLibraryFrom(rows);

    assert.equal(library.size, 4);
    assert.equal(library.get(id(1)).title, 'Not first');
    assert.equal(library.get(id(9)), undefined);

    const first = library.recommend(range, () => .25);
    assert.equal(first.candidateCount, 3);
    assert.equal(first.status, 'insufficient-candidates');
    assert.deepEqual(first.tracks.map(t => t.id).sort(), [1,2,3].map(id));
    assert.deepEqual(library.recommend(range, () => .25), first);

    const seeds = {mode:'seeds', spotifyIds:[id(1),id(2),id(3)], n:3};
    assert.equal(library.recommend(seeds, () => .25).status, 'complete');
    assert.throws(() => library.recommend({...seeds, spotifyIds:[id(1),id(2),id(4)]}), /기준곡/);

    assert.deepEqual(library.search('artist', 100, 0).tracks.map(t => t.title),
        ['Not first', 'Second song', 'First song', 'Out of bounds']);
    assert.equal(library.search('first', 1, 0).tracks[0].title, 'First song');
    assert.equal(library.search('first', 1, 1).tracks[0].title, 'Not first');
    assert.equal(library.search('', 100, 0).total, 0);

    assert.deepEqual(rows, snapshot);
});

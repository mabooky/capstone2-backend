import assert from 'node:assert/strict';
import test from 'node:test';
import { compareViews, recommend, VIEW_NAMES } from './recommend.ts';

const views = Object.keys(VIEW_NAMES);
const versions = {
  A: ['reccobeats-v1', 'reccobeats-v1'], B1: ['muse-theoretical-v1', 'muse-theoretical-v1'],
  B2: ['muse-observed-v1', 'muse-observed-v1'], C1: ['reccobeats-v1', 'muse-theoretical-v1'],
  C2: ['reccobeats-v1', 'muse-observed-v1'],
};
function axis(version, metric, coordinate) {
  const recco = version === 'reccobeats-v1';
  const source_version = recco ? 'synthetic-fixture-v1' : 'zenodo-4281165-v1.0.0';
  const bounds = recco ? [0, 1] : version === 'muse-theoretical-v1' ? [0, 9] :
    metric === 'valence' ? [.23500000000000001, 8.475] : [.1081132075471698, 7.27];
  return {
    raw: String(bounds[0] + (coordinate + 1) / 2 * (bounds[1] - bounds[0])), source_version,
    config: { version, provider: recco ? 'reccobeats' : 'muse', metric, source_version,
      raw_min: bounds[0], raw_max: bounds[1] },
  };
}
function row(i, v, a, view = 'A') {
  const [vv, av] = versions[view];
  const x = axis(vv, 'valence', v), y = axis(av, view === 'A' ? 'energy' : 'arousal', a);
  const vs = String((vv === 'reccobeats-v1' ? 100000 : 200000) + i);
  const ars = String((av === 'reccobeats-v1' ? 100000 : 200000) + i);
  return {
    song_id: String(i + 1), spotify_id: String(i + 1).padStart(22, '0'), valence: String(v), arousal: String(a),
    valence_source_id: vs, arousal_source_id: ars,
    valence_normalization_version: vv, arousal_normalization_version: av,
    valence_source_version: x.source_version, arousal_source_version: y.source_version,
    valence_raw_value: x.raw, arousal_raw_value: y.raw,
    valence_normalization_config: x.config, arousal_normalization_config: y.config,
  };
}
const query = overrides => ({ view: 'A', valence: 0, arousal: 0, ...overrides });
const songIds = result => result.tracks.map(t => String(t.row.song_id));
function oracle(rows, request) {
  const excluded = new Set((request.excludeSongIds ?? []).map(String));
  return rows.filter(r => !excluded.has(String(r.song_id))).map(r => ({ id: String(r.song_id), sid: r.spotify_id,
    score: (request.valenceWeight ?? 1) * (Number(r.valence) - request.valence) ** 2 +
      (request.arousalWeight ?? 1) * (Number(r.arousal) - request.arousal) ** 2 }))
    .filter(r => request.maxRadius === undefined || Math.sqrt(r.score) <= request.maxRadius)
    .sort((a, b) => a.score - b.score || (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0))
    .slice(0, request.limit ?? 100).map(r => r.id);
}

test('common SQL output is accepted by all five VIEWs; provenance is returned intact', () => {
  for (const view of views) {
    const original = row(1, .25, -.3, view);
    const result = recommend([original], query({ view }));
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].row, original);
    assert.equal(result.tracks[0].distanceSquared, .25 ** 2 + .3 ** 2);
  }
});
test('radius doubles until enough distinct tracks exist', () => {
  const result = recommend([row(0, 0, 0), row(1, .15, 0), row(2, .3, 0), row(3, .7, 0)], query({ limit: 3 }));
  assert.deepEqual(result.steps, [{ radius: .1, cumulativeCount: 1 }, { radius: .2, cumulativeCount: 2 },
    { radius: .4, cumulativeCount: 3 }]);
  assert.deepEqual(songIds(result), ['1', '2', '3']);
  assert.equal(result.reason, 'limit-reached');
});
test('nearest-first ranking and deterministic Spotify ID tie-break do not depend on input order', () => {
  const data = [row(9, 1, 0), row(1, -1, 0), row(2, 0, .1)];
  const result = recommend(data, query());
  assert.deepEqual(songIds(result), ['3', '2', '10']);
  assert.deepEqual(songIds(result), songIds(recommend([...data].reverse(), query())));
});
test('square corners and the largest required default radius are inclusive', () => {
  const result = recommend([row(0, -1, -1)], query({ valence: 1, arousal: 1 }));
  assert.deepEqual(songIds(result), ['1']);
  assert.equal(result.tracks[0].distanceSquared, 8);
  assert.equal(result.steps.at(-1).radius, 2 * Math.SQRT2);
});
test('explicit circular boundary includes exactly the boundary and returns shortages', () => {
  const result = recommend([row(0, .3, .4), row(1, .50001, 0)], query({ initialRadius: .5, maxRadius: .5 }));
  assert.deepEqual(songIds(result), ['1']);
  assert.equal(result.reason, 'radius-cap-reached');
});
test('radius zero returns only exact matches and can also expand safely', () => {
  const data = [row(0, 0, 0), row(1, 1, 1)];
  assert.deepEqual(songIds(recommend(data, query({ initialRadius: 0, maxRadius: 0 }))), ['1']);
  assert.equal(recommend(data, query({ initialRadius: 0 })).tracks.length, 2);
});
test('pathological tiny radius and growth cannot cause an unbounded loop', () => {
  const result = recommend([row(0, 1, 1)], query({ initialRadius: Number.MIN_VALUE, expansionFactor: 1 + Number.EPSILON }));
  assert.equal(result.tracks.length, 1);
  assert.ok(result.steps.length <= 64);
});
test('empty results, excluded tracks, and zero limit have explicit outcomes', () => {
  assert.equal(recommend([], query()).reason, 'no-candidates');
  assert.equal(recommend([row(0, .5, .5)], query({ excludeSongIds: [1n] })).reason, 'no-candidates');
  assert.equal(recommend([row(0, .5, .5)], query({ limit: 0 })).reason, 'zero-limit');
  assert.equal(recommend([row(0, .5, .5)], query()).tracks.length, 1);
});
test('result is capped at 100 without padding and smaller limits are honored', () => {
  const data = Array.from({ length: 151 }, (_, i) => row(i, 0, 0));
  assert.equal(recommend(data, query()).tracks.length, 100);
  assert.equal(recommend(data, query({ limit: 7 })).tracks.length, 7);
  assert.throws(() => recommend(data, query({ limit: 101 })), TypeError);
});
test('weights affect ranking; a zero-weight axis is allowed but all-zero weights are rejected', () => {
  const data = [row(0, .1, .9), row(1, .4, .1)];
  assert.deepEqual(songIds(recommend(data, query())), ['2', '1']);
  assert.deepEqual(songIds(recommend(data, query({ valenceWeight: 1, arousalWeight: 0 }))), ['1', '2']);
  assert.throws(() => recommend(data, query({ valenceWeight: 0, arousalWeight: 0 })), TypeError);
});
test('invalid target, limits, radii, weights, VIEW and exclusions are rejected at runtime', () => {
  for (const override of [{ valence: NaN }, { arousal: Infinity }, { valence: -1.01 }, { arousal: '0' },
    { valence: null }, { limit: -1 }, { limit: 1.5 }, { limit: null }, { view: 'other' },
    { valenceWeight: -1 }, { arousalWeight: null }, { valenceWeight: Number.MAX_VALUE },
    { expansionFactor: 1 }, { expansionFactor: Infinity }, { initialRadius: -.1 },
    { initialRadius: .5, maxRadius: .1 }, { maxRadius: Infinity }, { maxRadius: null },
    { excludeSongIds: '1' }, { excludeSongIds: [Number.MAX_SAFE_INTEGER + 1] }]) {
    assert.throws(() => recommend([], query(override)), TypeError);
  }
});
test('invalid/missing row coordinates and missing metadata never become zero coordinates', () => {
  for (const bad of [null, '', 'NaN', 'Infinity', true, undefined, 1.01,
    '1.000000000000000000001', '-1.000000000000000000001', '1.000000000000000001e0']) {
    assert.throws(() => recommend([{ ...row(0, 0, 0), valence: bad }], query()), TypeError);
  }
  for (const override of [{ song_id: 0 }, { spotify_id: 'bad' }, { valence_raw_value: 'NaN' },
    { valence_normalization_config: null }, { valence_source_version: '' }]) {
    assert.throws(() => recommend([{ ...row(0, 0, 0), ...override }], query()), TypeError);
  }
});
test('valid exact decimal boundaries and exponent notation remain accepted', () => {
  for (const value of ['1.0000', '-1.0000', '.1e1', '100e-2', '0.99999999999999999999', '1e-1000']) {
    assert.equal(recommend([{ ...row(0, 0, 0), valence: value }], query()).tracks.length, 1);
  }
});
test('identical repeated VIEW rows are displayed once without altering observations', () => {
  const original = row(0, 0, 0);
  const reordered = { ...original, valence_normalization_config:
    Object.fromEntries(Object.entries(original.valence_normalization_config).reverse()) };
  const result = recommend([original, reordered, original], query());
  assert.equal(result.tracks.length, 1);
  assert.equal(result.duplicateRowsIgnored, 2);
});
test('conflicting coordinates, provenance or canonical IDs fail rather than pick/merge a row', () => {
  const original = row(0, 0, 0);
  for (const change of [{ valence: '.5' }, { valence_raw_value: '.8' },
    { valence_source_id: '999', arousal_source_id: '999' }, { spotify_id: 'Z'.repeat(22) }, { song_id: '2' }]) {
    assert.throws(() => recommend([original, { ...original, ...change }], query()), TypeError);
  }
});
test('VIEW normalization version and same-source axis contracts are enforced', () => {
  assert.throws(() => recommend([row(0, 0, 0, 'B2')], query({ view: 'B1' })), TypeError);
  assert.throws(() => recommend([{ ...row(0, 0, 0), arousal_source_id: '500' }], query()), TypeError);
  const data = row(0, 0, 0, 'C1');
  assert.notEqual(data.valence_source_id, data.arousal_source_id);
  assert.equal(recommend([data], query({ view: 'C1' })).tracks.length, 1);
  assert.throws(() => recommend([{ ...data, arousal_normalization_config: { ...data.arousal_normalization_config,
    provider: 'reccobeats' } }], query({ view: 'C1' })), TypeError);
});
test('bigint IDs stay exact and unsafe JS number IDs are rejected', () => {
  const data = [{ ...row(0, 0, 0), song_id: '9007199254740993' },
    { ...row(1, .5, 0), song_id: 9007199254740994n }];
  assert.deepEqual(songIds(recommend(data, query({ excludeSongIds: ['9007199254740993'] }))), ['9007199254740994']);
  assert.throws(() => recommend([{ ...row(0, 0, 0), song_id: 9007199254740993 }], query()), TypeError);
});
test('frozen input arrays, rows, and provenance are never mutated', () => {
  const data = [row(1, .5, 0), row(0, 0, 0)];
  for (const item of data) {
    Object.freeze(item.valence_normalization_config); Object.freeze(item.arousal_normalization_config); Object.freeze(item);
  }
  Object.freeze(data);
  const before = JSON.stringify(data);
  recommend(data, query());
  assert.equal(JSON.stringify(data), before);
});
test('comparison uses an identical song intersection and reports independent VIEW coverage', () => {
  const input = Object.fromEntries(views.map((v, i) => [v, [row(0, .2, .2, v), row(i + 10, 0, 0, v)]]));
  const compared = compareViews(input, { valence: 0, arousal: 0 });
  assert.deepEqual(compared.commonSongIds, ['1']);
  for (const v of views) {
    assert.equal(compared.coverage[v], 2);
    assert.deepEqual(songIds(compared.results[v]), ['1']);
  }
});
test('no common songs or an empty VIEW produces no fallback to other datasets', () => {
  const input = Object.fromEntries(views.map((v, i) => [v, [row(i, 0, 0, v)]]));
  assert.deepEqual(compareViews(input, { valence: 0, arousal: 0 }).commonSongIds, []);
  input.B2 = [];
  for (const result of Object.values(compareViews(input, { valence: 0, arousal: 0 }).results)) {
    assert.equal(result.tracks.length, 0);
  }
});
test('comparison refuses identity disagreement across VIEWs', () => {
  const input = Object.fromEntries(views.map(v => [v, [row(0, 0, 0, v)]]));
  input.C2 = [{ ...input.C2[0], spotify_id: 'X'.repeat(22) }];
  assert.throws(() => compareViews(input, { valence: 0, arousal: 0 }), TypeError);
});
test('10,000 common synthetic songs: adaptive search equals independent full-sort oracle for all VIEWs', () => {
  const input = Object.fromEntries(views.map((v, offset) => [v,
    Array.from({ length: 10000 }, (_, i) => row(i,
      ((i * 73 + offset * 11) % 1001) / 500 - 1,
      ((i * 131 + offset * 17) % 1001) / 500 - 1, v))
      .concat(row(11000 + offset, 0, 0, v))]));
  for (const request of [{ valence: 0, arousal: 0 }, { valence: -1, arousal: 1, limit: 100 },
    { valence: .3, arousal: -.2, limit: 37, valenceWeight: 2, arousalWeight: .5,
      initialRadius: .001, maxRadius: .2, excludeSongIds: ['1', '2'] }]) {
    const compared = compareViews(input, request);
    assert.equal(compared.commonSongIds.length, 10000 - (request.excludeSongIds?.length ?? 0));
    const shared = new Set(compared.commonSongIds);
    for (const v of views) {
      assert.deepEqual(songIds(compared.results[v]), oracle(input[v].filter(r => shared.has(String(r.song_id))), request));
      assert.ok(compared.results[v].tracks.length <= 100);
      assert.ok(compared.results[v].steps.length <= 64);
    }
  }
});

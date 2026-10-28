import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.ts';
import { openCompactExperiment, MODEL_AXES, COMPACT_COLUMNS } from '../db/compact_experiment.ts';
import { recommend } from '../algorithm/recommend.ts';

const dataset = fileURLToPath(new URL('../data/experiment-v1/', import.meta.url));
const optIn = { allowUnverifiedLocalExperiment: true };
const request = (view = 'B1', changes = {}) => ({
  coordinateSpace: 'unit-interval-v1', view, valence: 0.5, arousal: 0.5, limit: 5, ...changes,
});

async function server(options) {
  const instance = createApp(options), http = createServer(instance.app);
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  return {
    async post(body) {
      const response = await fetch(`http://127.0.0.1:${http.address().port}/api/dev/music/recommendations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      return { status: response.status, body: response.status === 404 ? null : await response.json() };
    },
    async close() {
      http.closeAllConnections(); await new Promise(done => http.close(done)); await instance.close();
    },
  };
}

test('shared data reconstructs all 14 fields for five models without PGlite', async t => {
  const reader = await openCompactExperiment(dataset, optIn);
  assert.equal(reader.manifest.columns.length, 17);
  assert.equal(reader.manifest.format_version, 'music-compact-experiment-v2');
  assert.deepEqual(reader.manifest.columns, COMPACT_COLUMNS);
  for (const model of Object.keys(MODEL_AXES)) await t.test(model, async () => {
    const envelope = await reader.model(model);
    assert.equal(envelope.rows.length, 27948);
    assert.equal(envelope.verified, false); assert.equal(envelope.canonical_song_ids, false);
    assert(envelope.rows.every(row => Object.keys(row).length === 14));
    const result = recommend(envelope.rows, { view: model, valence: 0, arousal: 0, limit: 0 });
    assert.equal(result.availableCandidates, 27948); // limit=0 still validates every input row.
  });
  const a = (await reader.model('A')).rows;
  assert.equal(new Set(a.map(row => row.valence_source_version)).size, 27948);
  assert(a.every(row => typeof row.valence === 'string' && typeof row.valence_raw_value === 'string'));
  // Mutating a returned snapshot cannot change a later snapshot.
  a[0].valence_normalization_config.source_version = 'mutated-result';
  assert.notEqual((await reader.model('A')).rows[0].valence_normalization_config.source_version, 'mutated-result');
  await assert.rejects(() => reader.model('NOT_A_MODEL'));
  await reader.close();
});

test('metadata is complete and text fields are validated separately from numeric axes', async () => {
  const records = (await readFile(join(dataset, 'songs.jsonl'), 'utf8')).trimEnd().split('\n').map(JSON.parse);
  assert.equal(records.length, 27948);
  assert.equal(new Set(records.map(r => r[1])).size, 27948);
  assert(records.every(r => r.length === 17 && typeof r[15] === 'string' && r[15].trim()
    && typeof r[16] === 'string' && r[16].trim()));
  const originalColumns = records.map(r => JSON.stringify(r.slice(0, 15)) + '\n').join('');
  assert.equal(createHash('sha256').update(originalColumns).digest('hex'),
    'd4d690d86ad26f8011e710f798c85e13b346800d3626ff0641af4c3d1f368f6d',
    'Original 15 fields and row order must remain identical to format v1');
  const temporary = await mkdtemp(join(tmpdir(), 'music-compact-test-'));
  try {
    const copy = join(temporary, 'copy');
    await cp(dataset, copy, { recursive: true });
    const manifest = JSON.parse(await readFile(join(copy, 'manifest.json'), 'utf8'));
    async function checkMutation(index, value, pattern) {
      const modified = records.map((r, i) => i === 0 ? r.map((v, j) => j === index ? value : v) : r);
      const bytes = Buffer.from(modified.map(r => JSON.stringify(r) + '\n').join(''));
      manifest.artifacts['songs.jsonl'] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      await writeFile(join(copy, 'songs.jsonl'), bytes);
      await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
      await assert.rejects(() => openCompactExperiment(copy, optIn), pattern);
    }
    await checkMutation(15, '   ', /nonempty strings/);
    await checkMutation(16, 123, /nonempty strings/);
    await checkMutation(5, 'not-a-number');
    await checkMutation(9, '1.1');
  } finally {
    assert(relative(resolve(tmpdir()), resolve(temporary)).startsWith('music-compact-test-'));
    await rm(temporary, { recursive: true });
  }
});

test('default development HTTP source is the packaged dataset', async () => {
  const http = await server({ nodeEnv: 'development', enabled: true });
  const reader = await openCompactExperiment(dataset, optIn);
  try {
    const result = await http.post(request());
    assert.equal(result.status, 200);
    const expected = recommend((await reader.model('B1')).rows,
      { view: 'B1', valence: 0, arousal: 0, limit: 5 }).tracks.map(track => track.row.spotify_id);
    assert.deepEqual(result.body.spotifyIds, expected);
    assert.equal(result.body.experimental, true); assert.equal(result.body.verified, false);
    assert.equal('tracks' in result.body, false);
    assert.equal((await http.post(request('invalid'))).status, 400);
  } finally { await http.close(); await reader.close(); }
});

test('packaged dataset remains disabled in production', async () => {
  const http = await server({ nodeEnv: 'production', enabled: true, source: 'dataset' });
  try { assert.equal((await http.post(request())).status, 404); } finally { await http.close(); }
});

test('missing dataset fails with sanitized 503 and no PGlite fallback', async () => {
  const http = await server({ nodeEnv: 'development', enabled: true, source: 'dataset',
    datasetRoot: join(dataset, 'absent') });
  try {
    const result = await http.post(request());
    assert.equal(result.status, 503); assert.equal(result.body.error.code, 'EXPERIMENT_UNAVAILABLE');
    assert(!JSON.stringify(result.body).includes(dataset));
  } finally { await http.close(); }
});

test('checksum corruption and verified promotion are rejected', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'music-compact-test-'));
  try {
    await cp(dataset, join(temporary, 'copy'), { recursive: true });
    const copy = join(temporary, 'copy');
    const path = join(copy, 'normalization.json'), original = await readFile(path);
    await writeFile(path, Buffer.concat([original, Buffer.from(' ')]));
    await assert.rejects(() => openCompactExperiment(copy, optIn), /Size mismatch/);
    await writeFile(path, original);
    const manifest = JSON.parse(await readFile(join(copy, 'manifest.json'), 'utf8'));
    manifest.metadata.spotify_officially_verified = true;
    await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(() => openCompactExperiment(copy, optIn));
    manifest.metadata.spotify_officially_verified = false;
    manifest.verified = true;
    await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(() => openCompactExperiment(copy, optIn));
    await assert.rejects(() => openCompactExperiment(dataset, {}));
  } finally {
    assert(relative(resolve(tmpdir()), resolve(temporary)).startsWith('music-compact-test-'));
    await rm(temporary, { recursive: true });
  }
});

// Captured from the dataset-only HTTP API at the archived baseline commit 6eb1f96.
const regression = [
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "A",
      "valence": 0.5,
      "arousal": 0.5,
      "limit": 5
    },
    "spotifyIds": [
      "56b27J3f8IgjauSAbBvA2o",
      "0EPux2ELVyf2jxtpXGf3KH",
      "43iKgGbmfqPLh3mxUlospI",
      "58kmOPF7hFVLTVAu4argRe",
      "0uEp9E98JB5awlA084uaIg"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "A",
      "valence": 0.1,
      "arousal": 0.9,
      "limit": 5
    },
    "spotifyIds": [
      "7A3uaOpTtICqhAtwBbeaAB",
      "326GKzFhapEAQ8BCTxORQE",
      "3eZkW5bhQMp3KtcBJh4gDr",
      "2Jq2v7eIbP4rbIn4Rce7kb",
      "4t7qYHFuJkVs0LhYLIP6Oz"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "B1",
      "valence": 0.5,
      "arousal": 0.5,
      "limit": 5
    },
    "spotifyIds": [
      "72FzPhpeCWhWo0z63wmWyU",
      "7kNRIjtx99RfIHCvJKv52B",
      "6MZIuGKyA1SZwH3oH9jvXJ",
      "3ZJy7tB4oLWPxPAH101rPe",
      "2OXHF0zVr2TSqhpm80PS1P"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "B1",
      "valence": 0.1,
      "arousal": 0.9,
      "limit": 5
    },
    "spotifyIds": [
      "5IJbTPhcj0IjdzUaYqwe2I",
      "22pGUXnkdIOCXtb0kIclnq",
      "2SjpBcKifUxzgO3lG9eNm2",
      "4inojfeUyfcmV313nsizsA",
      "5Yg78W1IRkOBsHNMhT5TDh"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "B2",
      "valence": 0.5,
      "arousal": 0.5,
      "limit": 5
    },
    "spotifyIds": [
      "2s95Iq50JtytE3JwaDSWQn",
      "7vTCIwHvCT3zMmtYBo0uff",
      "2cs4flC9FpTI6ngU7Y9HRG",
      "4RD9ieX3yq8OLW5tlf1KLL",
      "1APu9lSrXWUarvP61myILk"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "B2",
      "valence": 0.1,
      "arousal": 0.9,
      "limit": 5
    },
    "spotifyIds": [
      "5IJbTPhcj0IjdzUaYqwe2I",
      "22pGUXnkdIOCXtb0kIclnq",
      "2SjpBcKifUxzgO3lG9eNm2",
      "4inojfeUyfcmV313nsizsA",
      "5Yg78W1IRkOBsHNMhT5TDh"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "C1",
      "valence": 0.5,
      "arousal": 0.5,
      "limit": 5
    },
    "spotifyIds": [
      "6dhfqStWHETvJWNhhLO1Qc",
      "698R7h4SU5zyNil1iReHAX",
      "5M93fqN6b9HNmfQGmXlqdu",
      "70xGLdhwkhoJiUBf4qRXEL",
      "74gmXOjhwnW0VUiwnxCpmU"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "C1",
      "valence": 0.1,
      "arousal": 0.9,
      "limit": 5
    },
    "spotifyIds": [
      "4UeTAzIPGeAEN9cBKE7asV",
      "5MrtuuhGztBlbkU9hE21OO",
      "74B6prL77fBbloaUY07yym",
      "12R7Drkzv56ssX6wnuhH0X",
      "6SeEZAbyE5mKQY1rw3ucav"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "C2",
      "valence": 0.5,
      "arousal": 0.5,
      "limit": 5
    },
    "spotifyIds": [
      "6ODnAiJq47k5uREuFXE9BO",
      "68lU6PxXnMBFLfBlq3cYxr",
      "1R5mc9pkvt3ZZ7r8nnnVVR",
      "2alSiZEFVvpWzkf3iKxGJt",
      "3r2d31Ro92xXWSNGXH3a5q"
    ]
  },
  {
    "request": {
      "coordinateSpace": "unit-interval-v1",
      "view": "C2",
      "valence": 0.1,
      "arousal": 0.9,
      "limit": 5
    },
    "spotifyIds": [
      "5pgACnIvUvQ6ZXvuc2MM7l",
      "1XBqW98bRzP5UB1REN8lpc",
      "6qzrABvo4DnUiDlg3nuJsf",
      "5LrXbJns8r44Chu2R9Tf7o",
      "4bDHr5yOmdI2nmbWvBpPS2"
    ]
  }
];
test('five-model ordered Spotify IDs retain the pre-streamlining baseline', async () => {
  const reader = await openCompactExperiment(dataset, optIn);
  try {
    for (const { request, spotifyIds } of regression) {
      const result = recommend((await reader.model(request.view)).rows, {
        view: request.view, valence: request.valence * 2 - 1, arousal: request.arousal * 2 - 1, limit: request.limit,
      });
      assert.deepEqual(result.tracks.map(t => t.row.spotify_id), spotifyIds);
    }
  } finally { await reader.close(); }
});

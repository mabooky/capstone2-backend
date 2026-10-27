import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.ts';
import { openCompactExperiment, MODEL_AXES, COMPACT_COLUMNS } from '../db/compact_experiment.ts';
import { recommend } from '../algorithm/recommend.ts';

const dataset = fileURLToPath(new URL('../data/experiment-v1/', import.meta.url));
const source = fileURLToPath(new URL('../.local/music-experiment-20261020-v3/', import.meta.url));
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
  assert.equal(reader.manifest.columns.length, 15);
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
    manifest.verified = true;
    await writeFile(join(copy, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(() => openCompactExperiment(copy, optIn));
    await assert.rejects(() => openCompactExperiment(dataset, {}));
  } finally {
    assert(relative(resolve(tmpdir()), resolve(temporary)).startsWith('music-compact-test-'));
    await rm(temporary, { recursive: true });
  }
});

test('all original PGlite fields and HTTP recommendation lists equal the packaged source', {
  skip: process.env.RUN_LOCAL_MUSIC_HTTP_TESTS !== 'true',
}, async t => {
  // Optional legacy tools are not imported during clean-clone dataset-only tests.
  const { openLocalExperiment } = await import('../db/query_local_experiment.mjs');
  const { fingerprint } = await import('../db/export_compact_experiment.mjs');
  const before = await fingerprint(source);
  const reader = await openLocalExperiment(source, { ...optIn, readOnlyCopy: true });
  const compact = await openCompactExperiment(dataset, optIn);
  let oldHttp, newHttp;
  try {
    for (const model of Object.keys(MODEL_AXES)) await t.test(`${model}: all 27948 rows / 14 fields`, async () => {
      assert.deepEqual((await compact.model(model)).rows, (await reader.model(model)).rows);
    });
    oldHttp = await server({ nodeEnv: 'development', enabled: true, source: 'pglite', experimentRoot: source });
    newHttp = await server({ nodeEnv: 'development', enabled: true, source: 'dataset' });
    for (const model of Object.keys(MODEL_AXES)) await t.test(`${model}: HTTP parity`, async () => {
      for (const changes of [{}, { valence: 0.1, arousal: 0.9, limit: 20 }]) {
        const body = request(model, changes);
        const [oldResult, newResult] = await Promise.all([oldHttp.post(body), newHttp.post(body)]);
        assert.equal(oldResult.status, 200); assert.deepEqual(newResult, oldResult);
      }
    });
  } finally {
    await oldHttp?.close(); await newHttp?.close(); await reader.close(); await compact.close();
    assert.deepEqual(await fingerprint(source), before, 'Original PGlite/input files changed');
  }
});

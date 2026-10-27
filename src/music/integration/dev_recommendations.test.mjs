import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../../app.ts';
import { openCompactExperiment } from '../db/compact_experiment.ts';
import { recommend } from '../algorithm/recommend.ts';
import { parseInput } from './dto.ts';

const dataset = fileURLToPath(new URL('../data/experiment-v1/', import.meta.url));
const endpoint = '/api/dev/music/recommendations';
const request = (view = 'B1', changes = {}) => ({
  coordinateSpace: 'unit-interval-v1', view, valence: 0.5, arousal: 0.5, limit: 5, ...changes,
});
async function withServer(options, run) {
  const instance = createApp(options), server = createServer(instance.app);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const rawPost = body => fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  try { return await run({ base, rawPost, post: body => rawPost(JSON.stringify(body)) }); }
  finally {
    server.closeAllConnections(); await new Promise((done, reject) => server.close(e => e ? reject(e) : done()));
    await instance.close();
  }
}
const enabled = { nodeEnv: 'development', enabled: true };

test('production, unset/test environment and missing opt-in return 404 even with obsolete settings', async () => {
  for (const options of [{ nodeEnv: 'production', enabled: true }, { enabled: true },
    { nodeEnv: 'test', enabled: true }, { nodeEnv: 'development', enabled: false }]) {
    await withServer({ ...options, source: 'pglite', experimentRoot: 'unsupported' }, async ({ post }) => {
      assert.equal((await post(request())).status, 404);
    });
  }
});

test('environment-based default configuration blocks production', async () => {
  const keys = ['NODE_ENV', 'ENABLE_DEV_MUSIC_RECOMMENDATIONS'];
  const saved = keys.map(key => process.env[key]);
  try {
    process.env.NODE_ENV = 'production'; process.env.ENABLE_DEV_MUSIC_RECOMMENDATIONS = 'true';
    await withServer(undefined, async ({ post }) => assert.equal((await post(request())).status, 404));
  } finally {
    keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
  }
});

test('bad VIEW, coordinates, contract and malformed JSON return 400 before data access', async () => {
  await withServer({ ...enabled, datasetRoot: join(tmpdir(), 'nonexistent-music-fixture') }, async ({ post, rawPost }) => {
    for (const body of [request('unknown'), request('B1', { valence: -0.1 }),
      request('B1', { arousal: 1.1 }), request('B1', { valence: '0.5' }),
      request('B1', { coordinateSpace: 'internal' }), request('B1', { limit: 101 }),
      request('B1', { limit: 1.5 }), request('B1', { excludeSongIds: ['1'] }), null,
      { coordinateSpace: 'unit-interval-v1', view: 'B1', valence: 0.5, arousal: 0.5 }]) {
      const response = await post(body); assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_INPUT');
    }
    assert.equal((await rawPost('{')).status, 400);
  });
});

test('obsolete file DB options and unknown sources fail explicitly without fallback', async () => {
  for (const options of [{ source: 'pglite' }, { source: 'unknown' },
    { experimentRoot: 'unsupported' }, { source: 'dataset', experimentRoot: 'unsupported' }]) {
    await withServer({ ...enabled, ...options }, async ({ post }) => {
      const response = await post(request()); assert.equal(response.status, 503);
      assert.equal((await response.json()).error.code, 'UNSUPPORTED_EXPERIMENT_SOURCE');
    });
  }
});

test('missing and corrupt packaged artifacts return sanitized 503; existing GET contracts survive', async () => {
  // Isolated copies contain only the shared JSON dataset; never a database directory.
  const temporary = await mkdtemp(join(tmpdir(), 'music-http-fixtures-'));
  for (const artifact of ['manifest.json', 'songs.jsonl', 'normalization.json']) {
    const copy = join(temporary, artifact + '-corrupt'); await cp(dataset, copy, { recursive: true });
    await writeFile(join(copy, artifact), 'corrupt fixture');
    await withServer({ ...enabled, datasetRoot: copy }, async ({ post }) => {
      const response = await post(request()); assert.equal(response.status, 503);
      const error = await response.json(); assert.equal(error.error.code, 'EXPERIMENT_UNAVAILABLE');
      assert(!JSON.stringify(error).includes(temporary));
    });
  }
  await withServer({ ...enabled, datasetRoot: join(temporary, 'missing') }, async ({ base, post }) => {
    assert.equal((await post(request())).status, 503);
    const catalog = await fetch(base + '/api/stores/test-store/catalog');
    const tracks = await fetch(base + '/api/stores/test-store/tracks');
    assert.equal(catalog.status, 200); assert.equal(tracks.status, 200);
    const a = await catalog.json(), b = await tracks.json();
    assert.deepEqual(a, b); assert.equal(a.length, 1); assert.equal(a[0].requestStatus, 'available');
    assert.equal(a[0].spotifyId, '11dFghVXANMlKmJXsNCbNl');
    assert.equal((await fetch(base + '/api/health')).status, 200);
  });
});

test('five models at central/asymmetric coordinates match direct ranking and response contract', async () => {
  const reader = await openCompactExperiment(dataset, { allowUnverifiedLocalExperiment: true });
  try {
    await withServer(enabled, async ({ post }) => {
      for (const view of ['A', 'B1', 'B2', 'C1', 'C2']) for (const [valence, arousal] of [[.5, .5], [.1, .9]]) {
        const input = request(view, { valence, arousal }), response = await post(input);
        assert.equal(response.status, 200); const result = await response.json();
        const expected = recommend((await reader.model(view)).rows, parseInput(input)).tracks.map(t => t.row.spotify_id);
        assert.deepEqual(result.spotifyIds, expected); assert.equal(result.returnedCount, expected.length);
        assert.equal(result.view, view); assert.equal(result.experimental, true); assert.equal(result.verified, false);
        assert.equal(result.canonicalSongIds, false); assert.equal(result.idNamespace, 'music_experiment.common_songs');
        assert.equal(result.datasetId, reader.manifest.dataset_id); assert.equal(result.coordinateSpace, 'unit-interval-v1');
        assert(result.spotifyIds.every(id => /^[A-Za-z0-9]{22}$/.test(id)));
        assert.equal(response.headers.get('cache-control'), 'no-store'); assert(!('tracks' in result));
      }
      assert.deepEqual(await (await post(request('B1', { limit: 0 }))).json().then(r => r.spotifyIds), []);
      const concurrent = await Promise.all(['A', 'B2', 'C2'].map(v => post(request(v))));
      assert(concurrent.every(r => r.status === 200));
    });
  } finally { await reader.close(); }
});

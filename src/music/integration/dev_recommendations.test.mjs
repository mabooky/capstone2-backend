import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createReadStream } from 'node:fs';
import { readFile, readdir, mkdtemp, mkdir, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative } from 'node:path';
import { createApp } from '../../app.ts';
import { recommend } from '../algorithm/recommend.ts';
import { parseInput } from './dto.ts';

const local = fileURLToPath(new URL('../.local/', import.meta.url));
const root = join(local, 'music-experiment-20261020-v3');
const endpoint = '/api/dev/music/recommendations';
const request = (view = 'B1', changes = {}) => ({
  coordinateSpace: 'unit-interval-v1', view, valence: 0.5, arousal: 0.5, limit: 5, ...changes,
});

async function withServer(options, run) {
  const instance = createApp(options);
  const server = createServer(instance.app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = body => fetch(base + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try { return await run({ base, post }); }
  finally {
    server.closeAllConnections();
    await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
    await instance.close();
  }
}

test('production, unset/test environment and missing opt-in return HTTP 404', async () => {
  for (const options of [
    { nodeEnv: 'production', enabled: true },
    { enabled: true }, { nodeEnv: 'test', enabled: true },
    { nodeEnv: 'development', enabled: false },
  ]) await withServer(options, async ({ post }) => {
    assert.equal((await post(request())).status, 404);
  });
});

test('default app configuration blocks production even with the enable flag', async () => {
  const previous = {
    NODE_ENV: process.env.NODE_ENV,
    ENABLE_DEV_MUSIC_RECOMMENDATIONS: process.env.ENABLE_DEV_MUSIC_RECOMMENDATIONS,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_DEV_MUSIC_RECOMMENDATIONS = 'true';
    await withServer(undefined, async ({ post }) => {
      assert.equal((await post(request())).status, 404);
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('bad VIEW/coordinates/contract are rejected before attempting DB access', async () => {
  await withServer({ nodeEnv: 'development', enabled: true, experimentRoot: join(local, 'absent-http-test') },
    async ({ post }) => {
      for (const body of [request('unknown'), request('B1', { valence: -0.1 }),
        request('B1', { arousal: 1.1 }), request('B1', { valence: '0.5' }),
        request('B1', { coordinateSpace: 'internal' }), request('B1', { limit: 101 }),
        request('B1', { excludeSongIds: ['1'] }), null,
        { coordinateSpace: 'unit-interval-v1', view: 'B1', valence: 0.5, arousal: 0.5 },
      ]) {
        const response = await post(body);
        assert.equal(response.status, 400);
        assert.equal((await response.json()).error.code, 'INVALID_INPUT');
      }
    });
});

test('missing experiment returns sanitized HTTP 503; existing GET endpoints still work', async () => {
  await withServer({ nodeEnv: 'development', enabled: true, experimentRoot: join(local, 'absent-http-test') },
    async ({ base, post }) => {
      const response = await post(request());
      assert.equal(response.status, 503);
      const error = await response.json();
      assert.equal(error.error.code, 'EXPERIMENT_UNAVAILABLE');
      assert(!JSON.stringify(error).includes(local));
      const catalog = await fetch(base + '/api/stores/test-store/catalog');
      const tracks = await fetch(base + '/api/stores/test-store/tracks');
      assert.equal(catalog.status, 200); assert.equal(tracks.status, 200);
      const a = await catalog.json(), b = await tracks.json();
      assert.deepEqual(a, b); assert.equal(a.length, 1);
      assert.equal(a[0].requestStatus, 'available');
      assert.equal((await fetch(base + '/api/health')).status, 200);
    });
});

async function fingerprint(directory) {
  const hash = createHash('sha256');
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        assert(entry.isFile()); hash.update(relative(directory, path));
        for await (const block of createReadStream(path)) hash.update(block);
      }
    }
  }
  await walk(directory); return hash.digest('hex');
}

test('local DB HTTP integration: five models, direct ranking parity and unchanged original files', {
  skip: process.env.RUN_LOCAL_MUSIC_HTTP_TESTS !== 'true',
}, async t => {
  const before = await fingerprint(root);
  try {
    await withServer({ nodeEnv: 'development', enabled: true, experimentRoot: root }, async ({ post }) => {
      for (const view of ['B1', 'A', 'B2', 'C1', 'C2']) await t.test(view, async () => {
        const response = await post(request(view));
        assert.equal(response.status, 200);
        const result = await response.json();
        const rows = (await readFile(join(root, view + '.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
        const expected = recommend(rows, parseInput(request(view))).tracks.map(track => track.row.spotify_id);
        assert.deepEqual(result.spotifyIds, expected);
        assert.equal(result.view, view); assert.equal(result.returnedCount, 5);
        assert.equal(result.experimental, true); assert.equal(result.verified, false);
        assert.equal(result.canonicalSongIds, false);
        assert.equal(result.idNamespace, 'music_experiment.common_songs');
        assert(result.spotifyIds.every(id => /^[A-Za-z0-9]{22}$/.test(id)));
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert(!('tracks' in result));
      });
      await t.test('zero limit and simultaneous requests', async () => {
        const zero = await post(request('B1', { limit: 0 }));
        assert.equal(zero.status, 200);
        assert.deepEqual((await zero.json()).spotifyIds, []);
        const results = await Promise.all(['A','B2','C2'].map(view => post(request(view))));
        assert(results.every(response => response.status === 200));
      });
    });

    for (const missing of ['manifest', 'database']) await t.test(`missing ${missing}`, async () => {
      const fixture = await mkdtemp(join(local, 'http-missing-'));
      try {
        await mkdir(join(fixture, 'snapshot/pgdata'), { recursive: true });
        if (missing === 'database') {
          await copyFile(join(root, 'manifest.json'), join(fixture, 'manifest.json'));
          await copyFile(join(root, 'snapshot/schema-manifest.json'), join(fixture, 'snapshot/schema-manifest.json'));
        }
        await withServer({ nodeEnv: 'development', enabled: true, experimentRoot: fixture }, async ({ post }) => {
          const response = await post(request());
          assert.equal(response.status, 503);
          assert.equal((await response.json()).error.code, 'EXPERIMENT_UNAVAILABLE');
        });
      } finally {
        assert(relative(local, resolve(fixture)).startsWith('http-missing-'));
        await rm(fixture, { recursive: true });
      }
    });
  } finally { assert.equal(await fingerprint(root), before, 'Original experiment files changed'); }
});

// Explicit export only. Source is opened through the existing read-only copy boundary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openLocalExperiment } from './query_local_experiment.mjs';
import { AXES, MODEL_AXES, COMPACT_COLUMNS, reconstructRow, openCompactExperiment } from './compact_experiment.ts';

const music = fileURLToPath(new URL('../', import.meta.url));
export async function fingerprint(root) {
  const hash = createHash('sha256'); let files = 0;
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        assert(entry.isFile()); hash.update(relative(root, path)); files++;
        for await (const block of createReadStream(path)) hash.update(block);
      }
    }
  }
  await walk(root); return { files, sha256: hash.digest('hex') };
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function exportCompactExperiment(sourceRoot, target) {
  const before = await fingerprint(sourceRoot);
  const reader = await openLocalExperiment(sourceRoot, { allowUnverifiedLocalExperiment: true, readOnlyCopy: true });
  let closed = false;
  try {
    const records = new Map();
    const config = { format_version: 'music-experiment-normalization-v1',
      shared_source_versions: { muse: '' }, axes: {}, models: MODEL_AXES };
    for (const model of ['A', 'B1', 'B2']) {
      for (const row of (await reader.model(model)).rows) {
        const id = row.song_id;
        if (model === 'A') {
          assert(!records.has(id));
          const record = Array(COMPACT_COLUMNS.length).fill('');
          record[0] = id; record[1] = row.spotify_id; records.set(id, record);
        }
        const record = records.get(id); assert(record); assert.equal(record[1], row.spotify_id);
        for (const [i, axisName] of MODEL_AXES[model].entries()) {
          const prefix = i === 0 ? 'valence' : 'arousal', axis = AXES[axisName];
          const sourceVersion = row[prefix + '_source_version'];
          const original = row[prefix + '_normalization_config'];
          assert.equal(original.source_version, sourceVersion);
          const { source_version, ...template } = original;
          if (config.axes[axisName]) assert.deepEqual(config.axes[axisName], template);
          else config.axes[axisName] = template;
          if (axis.provider === 'muse') {
            if (config.shared_source_versions.muse) assert.equal(config.shared_source_versions.muse, sourceVersion);
            else config.shared_source_versions.muse = sourceVersion;
          }
          const fields = [[axis.source, row[prefix + '_source_id']],
            [axis.raw, row[prefix + '_raw_value']], [axis.value, row[prefix]]];
          if (axis.provider === 'reccobeats') fields.push([4, sourceVersion]);
          for (const [index, value] of fields) {
            assert.equal(typeof value, 'string');
            if (record[index]) assert.equal(record[index], value); else record[index] = value;
          }
        }
      }
    }
    assert.equal(records.size, 27948);
    for (const record of records.values()) assert(record.every(value => value.length > 0));
    let matched = 0;
    for (const model of Object.keys(MODEL_AXES)) {
      for (const row of (await reader.model(model)).rows) {
        assert.deepEqual(reconstructRow(records.get(row.song_id), config, model), row);
        matched++;
      }
    }
    await reader.close();
    closed = true;
    const after = await fingerprint(sourceRoot); assert.deepEqual(after, before, 'Original input changed');
    const ordered = [...records.values()].sort((a,b) => BigInt(a[0]) < BigInt(b[0]) ? -1 : 1);
    const songs = ordered.map(row => JSON.stringify(row) + '\n').join('');
    const normalization = JSON.stringify(config, null, 2) + '\n';
    const sourceManifest = await readFile(resolve(sourceRoot, 'manifest.json'));
    const manifest = {
      format_version: 'music-compact-experiment-v1',
      dataset_kind: 'unverified-local-experiment-v1', dataset_id: reader.manifest.dataset_id,
      id_namespace: 'music_experiment.common_songs', verified: false, canonical_song_ids: false,
      coordinate_space: 'normalized-minus-one-to-one-v1', songs: ordered.length,
      columns: COMPACT_COLUMNS, models: Object.keys(MODEL_AXES),
      artifacts: Object.fromEntries([['songs.jsonl', songs], ['normalization.json', normalization]]
        .map(([name, bytes]) => [name, { bytes: Buffer.byteLength(bytes), sha256: sha(bytes) }])),
      source: { dataset: 'music-experiment-20261020-v3', manifest_sha256: sha(sourceManifest),
        database_views: Object.keys(MODEL_AXES).map(model => 'music_experiment.model_' + model.toLowerCase()) },
      validation: { model_rows_compared: matched, coordinate_pairs_compared: matched,
        all_14_fields_equal_to_pglite: true, original_files_unchanged: true, original_files_checked: before.files },
      rights: { github_sharing_authorized_by: 'Project owner confirmation in user instruction, 2026-10-27',
        authorization_document: 'Not supplied; see README.md. No additional open license is asserted.',
        muse: { title: 'MuSe: The Musical Sentiment Dataset', authors: ['Christopher Akiki', 'Manuel Burghardt'],
          source: 'https://zenodo.org/records/4281165', version: '1.0.0', license: 'CC BY 4.0' },
        reccobeats: { source: 'https://reccobeats.com', terms: 'https://reccobeats.com/docs/documentation/terms-of-service' } },
    };
    // Reserve a NEW directory. Never overwrite an earlier dataset or source file.
    await mkdir(target, { recursive: false });
    for (const [name, bytes] of [['songs.jsonl', songs], ['normalization.json', normalization],
      ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      await writeFile(resolve(target, name), bytes, { flag: 'wx' });
    }
    const exported = await openCompactExperiment(target, { allowUnverifiedLocalExperiment: true });
    for (const model of Object.keys(MODEL_AXES)) {
      const { rows } = await exported.model(model);
      assert.equal(rows.length, ordered.length);
      rows.forEach((row, index) => assert.deepEqual(row, reconstructRow(ordered[index], config, model)));
    }
    await exported.close();
    console.log(JSON.stringify({ result: 'PASS', songs: ordered.length, model_rows_compared: matched,
      original_files_unchanged: true, artifacts: manifest.artifacts }, null, 2));
  } finally {
    if (!closed) await reader.close();
    assert.deepEqual(await fingerprint(sourceRoot), before, 'Original input changed');
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = resolve(process.argv[3] ?? join(music, 'data/experiment-v1'));
  assert.equal(relative(resolve(music, 'data'), target).split(/[\\/]/).length, 1, 'Use a new data child folder');
  assert(!relative(resolve(music, 'data'), target).startsWith('..'));
  await mkdir(resolve(music, 'data'), { recursive: true });
  await exportCompactExperiment(resolve(process.argv[2] ?? join(music, '.local/music-experiment-20261020-v3')), target);
}

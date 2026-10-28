import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { NormalizationConfig, RecommendationView, RecommendationViewRow } from '../algorithm/recommend.js';
import type { LocalExperimentEnvelope } from './experiment_input.js';
import type { SongMetadata } from '../integration/repository.js';

export const COMPACT_COLUMNS = [
  'experiment_song_id', 'spotify_id', 'reccobeats_source_id', 'muse_source_id',
  'reccobeats_source_version', 'reccobeats_valence_raw', 'reccobeats_energy_raw',
  'muse_valence_raw', 'muse_arousal_raw', 'reccobeats_valence', 'reccobeats_energy',
  'muse_theoretical_valence', 'muse_theoretical_arousal', 'muse_observed_valence', 'muse_observed_arousal',
  'title', 'artist',
] as const;

// Original 15 indices are preserved in format v2; metadata occupies indices 15/16.
export const AXES = {
  reccobeats_valence: { value: 9, raw: 5, source: 2, provider: 'reccobeats', metric: 'valence', version: 'reccobeats-v1' },
  reccobeats_energy: { value: 10, raw: 6, source: 2, provider: 'reccobeats', metric: 'energy', version: 'reccobeats-v1' },
  muse_theoretical_valence: { value: 11, raw: 7, source: 3, provider: 'muse', metric: 'valence', version: 'muse-theoretical-v1' },
  muse_theoretical_arousal: { value: 12, raw: 8, source: 3, provider: 'muse', metric: 'arousal', version: 'muse-theoretical-v1' },
  muse_observed_valence: { value: 13, raw: 7, source: 3, provider: 'muse', metric: 'valence', version: 'muse-observed-v1' },
  muse_observed_arousal: { value: 14, raw: 8, source: 3, provider: 'muse', metric: 'arousal', version: 'muse-observed-v1' },
} as const;
export type Axis = keyof typeof AXES;
export const MODEL_AXES = {
  A: ['reccobeats_valence', 'reccobeats_energy'],
  B1: ['muse_theoretical_valence', 'muse_theoretical_arousal'],
  B2: ['muse_observed_valence', 'muse_observed_arousal'],
  C1: ['reccobeats_valence', 'muse_theoretical_arousal'],
  C2: ['reccobeats_valence', 'muse_observed_arousal'],
} as const satisfies Record<RecommendationView, readonly [Axis, Axis]>;

export interface CompactNormalization {
  format_version: 'music-experiment-normalization-v1';
  shared_source_versions: { muse: string };
  // source_version is supplied from each row for ReccoBeats, shared for MuSe.
  axes: Record<Axis, NormalizationConfig>;
  models: typeof MODEL_AXES;
}
export interface CompactManifest {
  format_version: 'music-compact-experiment-v2';
  dataset_kind: 'unverified-local-experiment-v1';
  dataset_id: string;
  id_namespace: 'music_experiment.common_songs';
  verified: false;
  canonical_song_ids: false;
  songs: number;
  columns: readonly string[];
  models: readonly string[];
  artifacts: Record<'songs.jsonl' | 'normalization.json', { bytes: number; sha256: string }>;
  metadata: {
    provider: 'muse'; source_version: string; source_sha256: string;
    fields: { title: 'track'; artist: 'artist' }; spotify_officially_verified: false;
  };
}

export function reconstructRow(record: readonly string[], config: CompactNormalization,
  model: RecommendationView): RecommendationViewRow {
  const [v, a] = MODEL_AXES[model].map(name => {
    const axis = AXES[name];
    const sourceVersion = axis.provider === 'reccobeats' ? record[4]! : config.shared_source_versions.muse;
    const template = config.axes[name];
    return {
      value: record[axis.value]!, raw: record[axis.raw]!, source: record[axis.source]!,
      sourceVersion, version: axis.version,
      config: { ...template, source_version: sourceVersion },
    };
  });
  return {
    song_id: record[0]!, spotify_id: record[1]!, valence: v!.value, arousal: a!.value,
    valence_source_id: v!.source, arousal_source_id: a!.source,
    valence_normalization_version: v!.version, arousal_normalization_version: a!.version,
    valence_source_version: v!.sourceVersion, arousal_source_version: a!.sourceVersion,
    valence_raw_value: v!.raw, arousal_raw_value: a!.raw,
    valence_normalization_config: v!.config, arousal_normalization_config: a!.config,
  };
}

export async function openCompactExperiment(root: string, options: { allowUnverifiedLocalExperiment: true }) {
  assert.equal(options?.allowUnverifiedLocalExperiment, true, 'Explicit experiment opt-in required');
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8')) as CompactManifest;
  assert.equal(manifest.format_version, 'music-compact-experiment-v2');
  assert.equal(manifest.dataset_kind, 'unverified-local-experiment-v1');
  assert.equal(manifest.verified, false); assert.equal(manifest.canonical_song_ids, false);
  assert.equal(manifest.id_namespace, 'music_experiment.common_songs');
  assert.match(manifest.dataset_id, /^music-experiment-[A-Za-z0-9-]+$/);
  assert.equal(manifest.songs, 27948);
  assert.deepEqual(manifest.columns, COMPACT_COLUMNS);
  assert.deepEqual(manifest.models, Object.keys(MODEL_AXES));
  async function checkedFile(name: 'songs.jsonl' | 'normalization.json') {
    const bytes = await readFile(resolve(root, name));
    assert.equal(bytes.byteLength, manifest.artifacts[name].bytes, `Size mismatch: ${name}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.artifacts[name].sha256,
      `Checksum mismatch: ${name}`);
    return bytes.toString('utf8');
  }
  const config = JSON.parse(await checkedFile('normalization.json')) as CompactNormalization;
  assert.equal(config.format_version, 'music-experiment-normalization-v1');
  assert.deepEqual(config.models, MODEL_AXES);
  assert.equal(typeof config.shared_source_versions.muse, 'string');
  assert.ok(config.shared_source_versions.muse.trim());
  assert.equal(manifest.metadata.provider, 'muse');
  assert.equal(manifest.metadata.source_version, config.shared_source_versions.muse);
  assert.equal(manifest.metadata.source_sha256, config.axes.muse_theoretical_valence.source_sha256);
  assert.deepEqual(manifest.metadata.fields, { title: 'track', artist: 'artist' });
  assert.equal(manifest.metadata.spotify_officially_verified, false);
  assert.deepEqual(Object.keys(config.axes).sort(), Object.keys(AXES).sort());
  for (const name of Object.keys(AXES) as Axis[]) {
    const template = config.axes[name], axis = AXES[name];
    assert.equal(template.provider, axis.provider); assert.equal(template.metric, axis.metric);
    assert.equal(template.version, axis.version); assert.ok(!Object.hasOwn(template, 'source_version'));
  }
  const text = await checkedFile('songs.jsonl');
  assert.ok(text.endsWith('\n'));
  const records: readonly string[][] = text.slice(0, -1).split('\n').map(line => JSON.parse(line) as string[]);
  assert.equal(records.length, manifest.songs);
  const songIds = new Set<string>(), spotifyIds = new Set<string>();
  const reccoIds = new Set<string>(), museIds = new Set<string>();
  for (const r of records) {
    assert.ok(Array.isArray(r) && r.length === COMPACT_COLUMNS.length);
    assert.ok(r.every(value => typeof value === 'string' && value.trim().length > 0),
      'All fields, including title and artist, must be nonempty strings');
    for (const index of [0, 2, 3]) assert.match(r[index]!, /^[1-9]\d*$/);
    assert.match(r[1]!, /^[A-Za-z0-9]{22}$/);
    for (const [index, seen] of [[0, songIds], [1, spotifyIds], [2, reccoIds], [3, museIds]] as const) {
      assert.ok(!seen.has(r[index]!), 'Duplicate dataset identity'); seen.add(r[index]!);
    }
    for (let i = 5; i < 15; i++) {
      assert.match(r[i]!, /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i);
      assert.ok(Number.isFinite(Number(r[i])));
      if (i >= 9) assert.ok(Number(r[i]) >= -1 && Number(r[i]) <= 1);
    }
  }
  const metadata = new Map<string, SongMetadata>(records.map(record => [record[1]!, {
    songId: record[0]!, title: record[15]!, artist: record[16]!, durationMs: null, reccobeatsId: null,
  }]));
  return {
    manifest,
    metadata(): ReadonlyMap<string, SongMetadata> {
      return new Map([...metadata].map(([id, value]) => [id, { ...value }]));
    },
    async model(model: string): Promise<LocalExperimentEnvelope> {
      assert.ok(Object.hasOwn(MODEL_AXES, model), 'Unknown experiment model');
      return {
        dataset_kind: manifest.dataset_kind, dataset_id: manifest.dataset_id,
        id_namespace: manifest.id_namespace, canonical_song_ids: false, verified: false,
        model: model as RecommendationView,
        rows: records.map(record => reconstructRow(record, config, model as RecommendationView)),
      };
    },
    async close() { /* Immutable files; no database, lock files or open handles. */ },
  };
}

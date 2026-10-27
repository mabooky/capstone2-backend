import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { recommend } from '../algorithm/recommend.js';
import { experimentRows } from '../db/experiment_input.js';
import { openCompactExperiment } from '../db/compact_experiment.js';
import type { LocalExperimentReader } from '../db/query_local_experiment.mjs';
import { InputError, parseInput } from './dto.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultExperimentRoot = resolve(repositoryRoot,
  'src/music/.local/music-experiment-20261020-v3');
export const defaultDatasetRoot = resolve(repositoryRoot, 'src/music/data/experiment-v1');

export class ExperimentUnavailableError extends Error {}

/** Development only: never constructs RecommendationService or canonical songs. */
export class DevExperimentService {
  private opening: Promise<LocalExperimentReader> | undefined;
  constructor(private readonly root = defaultDatasetRoot, private readonly source = 'dataset') {}

  private reader(): Promise<LocalExperimentReader> {
    if (!this.opening) {
      this.opening = (async () => {
        if (this.source === 'dataset') {
          return openCompactExperiment(this.root, { allowUnverifiedLocalExperiment: true });
        }
        if (this.source !== 'pglite') throw new Error('Unknown experiment source');
        // The existing .mjs tools and their ignored PGlite dependency live in the
        // source checkout, including when running a compiled development server.
        const moduleUrl = new URL('src/music/db/query_local_experiment.mjs',
          new URL('../../../', import.meta.url));
        const module = await import(moduleUrl.href) as typeof import('../db/query_local_experiment.mjs');
        return module.openLocalExperiment(this.root,
          { allowUnverifiedLocalExperiment: true, readOnlyCopy: true });
      })().catch(cause => {
        this.opening = undefined;
        throw new ExperimentUnavailableError('Local experiment unavailable', { cause });
      });
    }
    return this.opening;
  }

  async recommend(input: unknown) {
    const fields = ['coordinateSpace', 'view', 'valence', 'arousal', 'limit'];
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        fields.some(key => !Object.hasOwn(input, key)) ||
        Object.keys(input).some(key => !fields.includes(key))) {
      throw new InputError('Exactly coordinateSpace, view, valence, arousal and limit are required');
    }
    const request = parseInput(input);
    let envelope;
    try { envelope = await (await this.reader()).model(request.view); }
    catch (cause) { throw new ExperimentUnavailableError('Local experiment unavailable', { cause }); }
    const rows = experimentRows(envelope, { allowUnverifiedLocalExperiment: true });
    const result = recommend(rows, request);
    return {
      coordinateSpace: 'unit-interval-v1' as const,
      view: request.view,
      returnedCount: result.tracks.length,
      spotifyIds: result.tracks.map(track => track.row.spotify_id),
      reason: result.reason,
      experimental: true,
      verified: false,
      canonicalSongIds: false,
      idNamespace: envelope.id_namespace,
      datasetId: envelope.dataset_id,
    };
  }

  async close(): Promise<void> {
    const opening = this.opening;
    this.opening = undefined;
    if (opening) await (await opening).close();
  }
}

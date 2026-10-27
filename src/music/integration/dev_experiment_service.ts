import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { recommend } from '../algorithm/recommend.js';
import { experimentRows } from '../db/experiment_input.js';
import { openCompactExperiment } from '../db/compact_experiment.js';
import { InputError, parseInput } from './dto.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultDatasetRoot = resolve(repositoryRoot, 'src/music/data/experiment-v1');

export class ExperimentUnavailableError extends Error {}
export class UnsupportedExperimentSourceError extends ExperimentUnavailableError {}

/** Development only: never constructs RecommendationService or canonical songs. */
export class DevExperimentService {
  private opening: ReturnType<typeof openCompactExperiment> | undefined;
  constructor(private readonly root = defaultDatasetRoot, private readonly source = 'dataset',
    private readonly legacyRootConfigured = false) {}

  private reader(): ReturnType<typeof openCompactExperiment> {
    if (!this.opening) {
      this.opening = (async () => {
        if (this.source !== 'dataset' || this.legacyRootConfigured) {
          throw new UnsupportedExperimentSourceError('Only the packaged dataset source is supported');
        }
        return openCompactExperiment(this.root, { allowUnverifiedLocalExperiment: true });
      })().catch(cause => {
        this.opening = undefined;
        if (cause instanceof UnsupportedExperimentSourceError) throw cause;
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
    catch (cause) {
      if (cause instanceof ExperimentUnavailableError) throw cause;
      throw new ExperimentUnavailableError('Local experiment unavailable', { cause });
    }
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

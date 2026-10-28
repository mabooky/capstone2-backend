import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { experimentRows } from '../db/experiment_input.js';
import { openCompactExperiment } from '../db/compact_experiment.js';
import { InputError, parseInput, type ExperimentRecommendationOutput } from './dto.js';
import { RecommendationService } from './service.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const defaultDatasetRoot = resolve(repositoryRoot, 'src/music/data/experiment-v1');

export class ExperimentUnavailableError extends Error {}
export class UnsupportedExperimentSourceError extends ExperimentUnavailableError {}

/** Supplies packaged experiment data to the shared recommendation service; never canonical songs. */
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

  async recommend(input: unknown): Promise<ExperimentRecommendationOutput> {
    const fields = ['coordinateSpace', 'view', 'valence', 'arousal', 'limit'];
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        fields.some(key => !Object.hasOwn(input, key)) ||
        Object.keys(input).some(key => !fields.includes(key))) {
      throw new InputError('Exactly coordinateSpace, view, valence, arousal and limit are required');
    }
    const request = parseInput(input);
    let reader, envelope;
    try {
      reader = await this.reader();
      envelope = await reader.model(request.view);
    }
    catch (cause) {
      if (cause instanceof ExperimentUnavailableError) throw cause;
      throw new ExperimentUnavailableError('Local experiment unavailable', { cause });
    }
    const rows = experimentRows(envelope, { allowUnverifiedLocalExperiment: true });
    const service = new RecommendationService({ read: async () => ({ rows, metadata: reader.metadata() }) });
    const result = await service.recommend(input);
    return {
      ...result,
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

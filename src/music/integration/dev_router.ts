import express from 'express';
import { InputError } from './dto.js';
import { DevExperimentService, ExperimentUnavailableError,
  defaultDatasetRoot, defaultExperimentRoot } from './dev_experiment_service.js';

export interface DevMusicOptions {
  nodeEnv?: string | undefined;
  enabled?: boolean | undefined;
  experimentRoot?: string | undefined;
  datasetRoot?: string | undefined;
  source?: string | undefined;
}

export function createDevMusicRouter(options: DevMusicOptions = {}) {
  const router = express.Router();
  const enabled = options.nodeEnv === 'development' && options.enabled === true;
  // No file access or PGlite import occurs when the route is disabled.
  // Preserve existing explicit experimentRoot callers; otherwise use the shared dataset.
  const source = options.source ?? (options.experimentRoot ? 'pglite' : 'dataset');
  const root = source === 'pglite' ? options.experimentRoot ?? defaultExperimentRoot : options.datasetRoot ?? defaultDatasetRoot;
  const service = enabled ? new DevExperimentService(root, source) : undefined;
  router.post('/recommendations', async (req, res) => {
    if (!service) { res.sendStatus(404); return; }
    res.setHeader('Cache-Control', 'no-store');
    try { res.status(200).json(await service.recommend(req.body)); }
    catch (error) {
      if (error instanceof InputError) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid recommendation request' } });
      } else if (error instanceof ExperimentUnavailableError) {
        res.status(503).json({ error: { code: 'EXPERIMENT_UNAVAILABLE',
          message: 'Experiment dataset, DB, manifest or runtime is missing or invalid' } });
      } else {
        res.status(500).json({ error: { code: 'EXPERIMENT_DATA_INVALID',
          message: 'Invalid local experiment data' } });
      }
    }
  });
  const invalidJson: express.ErrorRequestHandler = (error, req, res, next) => {
    if (enabled && error instanceof SyntaxError && 'status' in error && error.status === 400) {
      res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid recommendation request' } });
    } else { next(error); }
  };
  return { router, errorHandler: invalidJson, close: async () => { await service?.close(); } };
}

import express from 'express';
import { InputError } from './dto.js';
import { DevExperimentService, ExperimentUnavailableError,
  defaultDatasetRoot, UnsupportedExperimentSourceError } from './dev_experiment_service.js';

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
  // Disabled routes never load data. Legacy options remain only to reject them explicitly.
  const service = enabled ? new DevExperimentService(options.datasetRoot ?? defaultDatasetRoot,
    options.source ?? 'dataset', options.experimentRoot !== undefined) : undefined;
  router.post('/recommendations', async (req, res) => {
    if (!service) { res.sendStatus(404); return; }
    res.setHeader('Cache-Control', 'no-store');
    try { res.status(200).json(await service.recommend(req.body)); }
    catch (error) {
      if (error instanceof InputError) {
        res.status(400).json({ error: { code: 'INVALID_INPUT', message: 'Invalid recommendation request' } });
      } else if (error instanceof UnsupportedExperimentSourceError) {
        res.status(503).json({ error: { code: 'UNSUPPORTED_EXPERIMENT_SOURCE',
          message: 'Only dataset is supported; remove MUSIC_EXPERIMENT_ROOT and use MUSIC_DATASET_ROOT' } });
      } else if (error instanceof ExperimentUnavailableError) {
        res.status(503).json({ error: { code: 'EXPERIMENT_UNAVAILABLE',
          message: 'Experiment dataset or manifest is missing or invalid' } });
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

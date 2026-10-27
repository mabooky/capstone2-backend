import type { LocalExperimentEnvelope } from './experiment_input.js';

export interface LocalExperimentReader {
  readonly manifest: { readonly dataset_id: string };
  model(model: string): Promise<LocalExperimentEnvelope>;
  close(): Promise<void>;
}

export function openLocalExperiment(root: string, options: {
  allowUnverifiedLocalExperiment: true;
  readOnlyCopy?: boolean;
}): Promise<LocalExperimentReader>;

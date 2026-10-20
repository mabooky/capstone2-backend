/** Local experiment boundary. Never pass these IDs/rows to a service repository. */
import type { RecommendationView, RecommendationViewRow } from '../algorithm/recommend.js';

export interface LocalExperimentEnvelope {
  readonly dataset_kind: 'unverified-local-experiment-v1';
  readonly dataset_id: string;
  readonly id_namespace: 'music_experiment.common_songs';
  readonly canonical_song_ids: false;
  readonly verified: false;
  readonly model: RecommendationView;
  readonly rows: readonly RecommendationViewRow[];
}

/** Opt-in is required even though the structural 14-column row type matches the algorithm. */
export function experimentRows(
  envelope: LocalExperimentEnvelope,
  options: { readonly allowUnverifiedLocalExperiment: true },
): readonly RecommendationViewRow[] {
  if (options?.allowUnverifiedLocalExperiment !== true ||
      envelope.dataset_kind !== 'unverified-local-experiment-v1' ||
      !/^music-experiment-[A-Za-z0-9-]+$/.test(envelope.dataset_id) ||
      envelope.id_namespace !== 'music_experiment.common_songs' ||
      envelope.canonical_song_ids !== false || envelope.verified !== false ||
      !['A', 'B1', 'B2', 'C1', 'C2'].includes(envelope.model) || !Array.isArray(envelope.rows)) {
    throw new TypeError('Explicit unverified local experiment envelope required');
  }
  return envelope.rows;
}

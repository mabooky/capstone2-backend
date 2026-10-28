import { VIEW_NAMES, type RecommendationView, type RecommendationResult } from '../algorithm/recommend.js';

export class InputError extends Error {}
export class DataError extends Error {}
export class DatabaseError extends Error {}

/** Draft contract for a separate recommendation endpoint; does not replace Track. */
export interface RecommendationInput {
  readonly coordinateSpace: 'unit-interval-v1';
  readonly view: RecommendationView;
  readonly valence: number;
  readonly arousal: number;
  readonly limit?: number;
  readonly excludeSongIds?: readonly string[];
}
export interface RequestContext { readonly excludeSongIds?: readonly string[] }
export interface RecommendationTrack {
  readonly songId: string;
  readonly spotifyId: string;
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number | null;
  readonly valence: number;
  readonly arousal: number;
  readonly normalization: { readonly valence: string; readonly arousal: string };
}
export interface RecommendationOutput {
  readonly coordinateSpace: 'unit-interval-v1';
  readonly view: RecommendationView;
  readonly tracks: readonly RecommendationTrack[];
  readonly returnedCount: number;
  readonly reason: RecommendationResult['reason'];
}
export interface ExperimentRecommendationOutput extends RecommendationOutput {
  readonly experimental: true;
  readonly verified: false;
  readonly canonicalSongIds: false;
  readonly idNamespace: 'music_experiment.common_songs';
  readonly datasetId: string;
}
export interface ParsedInput {
  readonly view: RecommendationView;
  readonly valence: number;
  readonly arousal: number;
  readonly limit: number;
  readonly excludeSongIds: readonly string[];
}
export function selectView(value: unknown): RecommendationView {
  if (typeof value !== 'string' || !Object.hasOwn(VIEW_NAMES, value)) throw new InputError('Unknown VIEW');
  return value as RecommendationView;
}
export function toInternal(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new InputError('Coordinate must be a finite number in [0,1]');
  return 2 * value - 1;
}
export function toExternal(value: number): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) throw new DataError('Invalid internal coordinate');
  return (value + 1) / 2;
}
export function excludeIds(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(id => typeof id !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n))
    throw new InputError('Excluded IDs must be positive decimal strings');
  return [...new Set(value as string[])];
}
export function parseInput(value: unknown, context: RequestContext = {}): ParsedInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Object required');
  const input = value as Record<string, unknown>;
  const allowed = new Set(['coordinateSpace', 'view', 'valence', 'arousal', 'limit', 'excludeSongIds']);
  if (Object.keys(input).some(key => !allowed.has(key)) || input.coordinateSpace !== 'unit-interval-v1')
    throw new InputError('Unknown fields or coordinate space');
  const view = selectView(input.view), valence = toInternal(input.valence), arousal = toInternal(input.arousal);
  const limit = input.limit === undefined ? 100 : input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0 || limit > 100)
    throw new InputError('Limit must be an integer in [0,100]');
  const clientExclusions = excludeIds(input.excludeSongIds);
  let serverExclusions: readonly string[];
  try { serverExclusions = excludeIds(context.excludeSongIds); }
  catch (cause) { throw new DataError('Invalid server exclusions', { cause }); }
  return { view, valence, arousal, limit,
    excludeSongIds: [...new Set([...clientExclusions, ...serverExclusions])] };
}

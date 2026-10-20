import { recommend } from '../algorithm/recommend.js';
import { DataError, DatabaseError, InputError, parseInput, toExternal,
  type RecommendationOutput, type RequestContext } from './dto.js';
import { RecommendationRepository } from './repository.js';

export class RecommendationService {
  constructor(private readonly repository: RecommendationRepository) {}
  async recommend(input: unknown, context: RequestContext = {}): Promise<RecommendationOutput> {
    const request = parseInput(input, context);
    if (request.limit === 0) return { coordinateSpace: 'unit-interval-v1', view: request.view,
      tracks: [], returnedCount: 0, reason: 'zero-limit' };
    const snapshot = await this.repository.read(request.view, request.excludeSongIds);
    try {
      const result = recommend(snapshot.rows, request);
      const tracks = result.tracks.map(({ row }) => {
        const songId = String(row.song_id), metadata = snapshot.metadata.get(songId);
        if (!metadata) throw new DataError('Catalog metadata missing');
        return { songId, spotifyId: row.spotify_id, reccobeatsId: metadata.reccobeatsId,
          title: metadata.title, artist: metadata.artist, durationMs: metadata.durationMs,
          albumImageUrl: null,
          valence: toExternal(Number(row.valence)), arousal: toExternal(Number(row.arousal)),
          normalization: { valence: row.valence_normalization_version, arousal: row.arousal_normalization_version } };
      });
      return { coordinateSpace: 'unit-interval-v1', view: request.view,
        tracks, returnedCount: tracks.length, reason: result.reason };
    } catch (cause) {
      if (cause instanceof DataError) throw cause;
      throw new DataError('Invalid recommendation snapshot', { cause });
    }
  }
}
export interface ErrorBody { readonly error: { readonly code: string; readonly message: string } }
export type RecommendationHttpResult =
  | { readonly status: 200; readonly body: RecommendationOutput }
  | { readonly status: 400 | 500 | 503; readonly body: ErrorBody };

/** Framework-neutral HTTP bridge; does not mount routes or start a server. */
export async function handleRecommendation(service: RecommendationService, body: unknown,
  context: RequestContext = {}): Promise<RecommendationHttpResult> {
  try { return { status: 200, body: await service.recommend(body, context) }; }
  catch (error) {
    if (error instanceof InputError) return { status: 400,
      body: { error: { code: 'INVALID_INPUT', message: 'Invalid recommendation request' } } };
    if (error instanceof DatabaseError) return { status: 503,
      body: { error: { code: 'DATABASE_UNAVAILABLE', message: 'Recommendation database unavailable' } } };
    return { status: 500,
      body: { error: { code: 'RECOMMENDATION_FAILED', message: 'Unable to build recommendations' } } };
  }
}

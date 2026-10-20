import { VIEW_NAMES, type RecommendationViewRow, type NormalizationConfig } from '../algorithm/recommend.js';
import { DatabaseError, DataError, excludeIds, selectView } from './dto.js';

/** Structurally compatible with a PGlite client or an approved PostgreSQL client. */
export interface MusicQueryClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
export interface SongMetadata {
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number | null;
  readonly reccobeatsId: string | null;
}
export interface CandidateSnapshot {
  readonly rows: readonly RecommendationViewRow[];
  readonly metadata: ReadonlyMap<string, SongMetadata>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new DataError('Invalid database text');
  return value;
}
function id(value: unknown): string {
  const result = text(value);
  if (!/^[1-9]\d{0,18}$/.test(result) || BigInt(result) > 9223372036854775807n)
    throw new DataError('Invalid database ID');
  return result;
}
function config(value: unknown): NormalizationConfig {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new DataError('Invalid JSONB'); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('Invalid JSONB object');
  return value as NormalizationConfig;
}
function row(value: unknown): { row: RecommendationViewRow; metadata: SongMetadata } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('Invalid database row');
  const r = value as Record<string, unknown>;
  const spotify = text(r.spotify_id);
  if (!/^[A-Za-z0-9]{22}$/.test(spotify)) throw new DataError('Invalid Spotify ID');
  const duration = r.catalog_duration_ms;
  if (duration !== null && (typeof duration !== 'number' || !Number.isSafeInteger(duration) || duration < 0))
    throw new DataError('Invalid duration');
  const recco = r.catalog_reccobeats_id;
  if (recco !== null && (typeof recco !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recco)))
    throw new DataError('Invalid ReccoBeats ID');
  return {
    row: {
      song_id: id(r.song_id), spotify_id: spotify,
      valence: text(r.valence), arousal: text(r.arousal),
      valence_source_id: id(r.valence_source_id), arousal_source_id: id(r.arousal_source_id),
      valence_normalization_version: text(r.valence_normalization_version),
      arousal_normalization_version: text(r.arousal_normalization_version),
      valence_source_version: text(r.valence_source_version), arousal_source_version: text(r.arousal_source_version),
      valence_raw_value: text(r.valence_raw_value), arousal_raw_value: text(r.arousal_raw_value),
      valence_normalization_config: config(r.valence_normalization_config),
      arousal_normalization_config: config(r.arousal_normalization_config),
    },
    metadata: { title: text(r.catalog_title), artist: text(r.catalog_artist),
      durationMs: duration as number | null, reccobeatsId: recco as string | null },
  };
}

/** One SELECT snapshot, no early LIMIT, no writes, no raw pending-source fallback. */
export class RecommendationRepository {
  constructor(private readonly client: MusicQueryClient) {}
  async read(view: unknown, excluded: readonly string[] = []): Promise<CandidateSnapshot> {
    const selected = selectView(view), exclusions = excludeIds(excluded);
    const sql = `SELECT v.song_id::text AS song_id,v.spotify_id,
      v.valence::text AS valence,v.arousal::text AS arousal,
      v.valence_source_id::text AS valence_source_id,v.arousal_source_id::text AS arousal_source_id,
      v.valence_normalization_version,v.arousal_normalization_version,
      v.valence_source_version,v.arousal_source_version,
      v.valence_raw_value::text AS valence_raw_value,v.arousal_raw_value::text AS arousal_raw_value,
      v.valence_normalization_config,v.arousal_normalization_config,
      s.title AS catalog_title,s.artist AS catalog_artist,s.duration_ms AS catalog_duration_ms,
      rb.external_id AS catalog_reccobeats_id
      FROM ${VIEW_NAMES[selected]} v JOIN music.songs s ON s.id=v.song_id
      LEFT JOIN music.song_sources rb ON rb.song_id=s.id AND rb.provider='reccobeats'
        AND rb.match_status='verified' AND rb.is_recommendation_source
      WHERE NOT (v.song_id=ANY($1::bigint[]))`;
    let raw: unknown[];
    try { raw = (await this.client.query(sql, [[...exclusions]])).rows; }
    catch (cause) { throw new DatabaseError('Recommendation database unavailable', { cause }); }
    if (!Array.isArray(raw)) throw new DataError('Invalid query result');
    const rows: RecommendationViewRow[] = [], metadata = new Map<string, SongMetadata>();
    for (const value of raw) {
      const parsed = row(value), songId = String(parsed.row.song_id), previous = metadata.get(songId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(parsed.metadata))
        throw new DataError('Conflicting catalog metadata');
      rows.push(parsed.row);
      metadata.set(songId, parsed.metadata);
    }
    return { rows, metadata };
  }
}

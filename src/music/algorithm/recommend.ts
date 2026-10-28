/** Pure recommendation over the common output of music.recommend_a/b1/b2/c1/c2.
 * Callers supply rows from trusted VIEWs; this module cannot verify matching evidence
 * and never changes source verification, calls APIs, or executes SQL.
 */
export const VIEW_NAMES = Object.freeze({
  A: 'music.recommend_a', B1: 'music.recommend_b1', B2: 'music.recommend_b2',
  C1: 'music.recommend_c1', C2: 'music.recommend_c2',
} as const);
export type RecommendationView = keyof typeof VIEW_NAMES;
export type DatabaseId = string | number | bigint;
export type DatabaseNumeric = string | number;
export type JsonValue = null | string | number | boolean | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type NormalizationConfig = { readonly [key: string]: JsonValue };

export interface RecommendationViewRow {
  readonly song_id: DatabaseId;
  readonly spotify_id: string;
  readonly valence: DatabaseNumeric;
  readonly arousal: DatabaseNumeric;
  readonly valence_source_id: DatabaseId;
  readonly arousal_source_id: DatabaseId;
  readonly valence_normalization_version: string;
  readonly arousal_normalization_version: string;
  readonly valence_source_version: string;
  readonly arousal_source_version: string;
  readonly valence_raw_value: DatabaseNumeric;
  readonly arousal_raw_value: DatabaseNumeric;
  readonly valence_normalization_config: NormalizationConfig;
  readonly arousal_normalization_config: NormalizationConfig;
}

export interface RecommendationRequest {
  readonly view: RecommendationView;
  readonly valence: number;
  readonly arousal: number;
  readonly limit?: number;
  readonly excludeSongIds?: readonly DatabaseId[];
  readonly valenceWeight?: number;
  readonly arousalWeight?: number;
  readonly initialRadius?: number;
  readonly expansionFactor?: number;
  readonly maxRadius?: number;
}
export interface RankedTrack {
  readonly row: RecommendationViewRow;
  readonly distanceSquared: number;
  readonly distance: number;
}
export interface RadiusStep {
  readonly radius: number;
  readonly cumulativeCount: number;
}
export interface RecommendationResult {
  readonly view: RecommendationView;
  readonly tracks: readonly RankedTrack[];
  readonly steps: readonly RadiusStep[];
  readonly availableCandidates: number;
  readonly duplicateRowsIgnored: number;
  readonly reason: 'limit-reached' | 'radius-cap-reached' | 'no-candidates' | 'zero-limit';
}
export interface ViewComparison {
  readonly commonSongIds: readonly string[];
  /** Unique valid candidates in each VIEW, after exclusions and before intersection. */
  readonly coverage: Readonly<Record<RecommendationView, number>>;
  readonly results: Readonly<Record<RecommendationView, RecommendationResult>>;
}

const VIEWS = Object.keys(VIEW_NAMES) as RecommendationView[];
const THEORETICAL = 'muse-theoretical-v1';
const OBSERVED = 'muse-observed-v1';
const RECCO = 'reccobeats-v1';
const VERSIONS: Readonly<Record<RecommendationView, readonly [string, string]>> = {
  A: [RECCO, RECCO], B1: [THEORETICAL, THEORETICAL], B2: [OBSERVED, OBSERVED],
  C1: [RECCO, THEORETICAL], C2: [RECCO, OBSERVED],
};
interface Candidate { row: RecommendationViewRow; id: string; v: number; a: number; fingerprint: string }
interface Prepared { candidates: Candidate[]; duplicates: number }
interface Options {
  v: number; a: number; limit: number; vw: number; aw: number;
  initial: number; growth: number; max: number; excluded: Set<string>;
}
function fail(message: string): never { throw new TypeError(message); }
function view(value: unknown): RecommendationView {
  if (typeof value !== 'string' || !Object.hasOwn(VIEW_NAMES, value)) fail('Unknown recommendation VIEW');
  return value as RecommendationView;
}
function numeric(value: unknown, label: string): number {
  if (typeof value !== 'number' && (typeof value !== 'string' ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) fail(`${label} must be a finite decimal`);
  const result = Number(value);
  if (!Number.isFinite(result)) fail(`${label} must be finite`);
  return result;
}
function coordinate(value: unknown, label: string, numbersOnly = false): number {
  if (numbersOnly && typeof value !== 'number') fail(`${label} must be a number`);
  const result = numeric(value, label);
  if (result < -1 || result > 1) fail(`${label} must be in [-1,1]`);
  if (typeof value === 'string') {
    // Reject exact SQL decimals just outside the boundary even if Number rounds them to +/-1.
    const [mantissa = '', exponent = '0'] = value.replace(/^[+-]/, '').toLowerCase().split('e');
    const [whole = '', fraction = ''] = mantissa.split('.');
    const digits = (whole + fraction).replace(/^0+/, '');
    const integerDigits = digits.length + Number(exponent) - fraction.length;
    if (digits && (integerDigits > 1 || (integerDigits === 1 &&
        (digits[0] !== '1' || /[1-9]/.test(digits.slice(1)))))) fail(`${label} must be in [-1,1]`);
  }
  return result;
}
function id(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 1) fail('IDs must be positive safe integers, bigint or decimal strings');
    return String(value);
  }
  if (typeof value === 'bigint') { if (value < 1n) fail('ID must be positive'); return String(value); }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) fail('ID must be a positive integer');
  return value;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a nonempty string`);
  return value;
}
/** Key-order independent JSON comparison; no mutation or lossy metadata dropping. */
function jsonKey(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null || ancestors.has(value)) fail('Config must be finite, acyclic JSON');
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail('Config must be a JSON object');
  }
  ancestors.add(value);
  const result = Array.isArray(value)
    ? '[' + value.map(item => jsonKey(item, ancestors)).join(',') + ']'
    : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' +
      jsonKey((value as Record<string, unknown>)[key], ancestors)).join(',') + '}';
  ancestors.delete(value);
  return result;
}
function config(value: unknown, version: string, metric: string, sourceVersion: string): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail('Missing normalization config');
  const c = value as Record<string, unknown>;
  if (c.version !== version || c.metric !== metric || c.provider !== (version === RECCO ? 'reccobeats' : 'muse') ||
      c.source_version !== sourceVersion) fail('Normalization config does not match VIEW/source');
  return jsonKey(value);
}
function options(request: RecommendationRequest): Options {
  if (request === null || typeof request !== 'object') fail('Missing recommendation request');
  view(request.view);
  const v = coordinate(request.valence, 'Target valence', true);
  const a = coordinate(request.arousal, 'Target arousal', true);
  const limit = request.limit === undefined ? 100 : request.limit;
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) fail('limit must be an integer in [0,100]');
  const vw = request.valenceWeight === undefined ? 1 : request.valenceWeight;
  const aw = request.arousalWeight === undefined ? 1 : request.arousalWeight;
  if (typeof vw !== 'number' || typeof aw !== 'number' || !Number.isFinite(vw) || !Number.isFinite(aw) ||
      vw < 0 || aw < 0 || vw + aw <= 0 || !Number.isFinite(4 * (vw + aw))) fail('Invalid distance weights');
  const coverageRadius = Math.sqrt(4 * (vw + aw));
  const max = request.maxRadius === undefined ? coverageRadius : request.maxRadius;
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 0 || max > coverageRadius) fail('Invalid maxRadius');
  const initial = request.initialRadius === undefined ? Math.min(.1, max) : request.initialRadius;
  if (typeof initial !== 'number' || !Number.isFinite(initial) || initial < 0 || initial > max) fail('Invalid initialRadius');
  const growth = request.expansionFactor === undefined ? 2 : request.expansionFactor;
  if (typeof growth !== 'number' || !Number.isFinite(growth) || growth <= 1) fail('expansionFactor must exceed 1');
  if (request.excludeSongIds !== undefined && !Array.isArray(request.excludeSongIds)) fail('excludeSongIds must be an array');
  const excluded = new Set((request.excludeSongIds ?? []).map(id));
  return { v, a, limit, vw, aw, initial, growth, max, excluded };
}
function prepare(rows: readonly RecommendationViewRow[], selected: RecommendationView, opts: Options): Prepared {
  if (!Array.isArray(rows)) fail('VIEW rows must be an array');
  const [vv, av] = VERSIONS[selected];
  const bySong = new Map<string, Candidate>(), bySpotify = new Map<string, string>();
  let duplicates = 0;
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) fail('Invalid VIEW row');
    const song = id(row.song_id), vs = id(row.valence_source_id), ars = id(row.arousal_source_id);
    if (typeof row.spotify_id !== 'string' || !/^[0-9A-Za-z]{22}$/.test(row.spotify_id)) fail('Invalid Spotify ID');
    const v = coordinate(row.valence, 'VIEW valence'), a = coordinate(row.arousal, 'VIEW arousal');
    if (row.valence_normalization_version !== vv || row.arousal_normalization_version !== av) fail('Mixed VIEW normalization versions');
    const vsv = text(row.valence_source_version, 'Valence source version');
    const asv = text(row.arousal_source_version, 'Arousal source version');
    if ((selected === 'A' || selected === 'B1' || selected === 'B2') && (vs !== ars || vsv !== asv)) {
      fail('Both axes must use the same source for A/B1/B2');
    }
    numeric(row.valence_raw_value, 'Raw valence'); numeric(row.arousal_raw_value, 'Raw arousal/energy');
    const vc = config(row.valence_normalization_config, vv, 'valence', vsv);
    const ac = config(row.arousal_normalization_config, av, selected === 'A' ? 'energy' : 'arousal', asv);
    const fingerprint = JSON.stringify([song, row.spotify_id, v, a, vs, ars, vv, av, vsv, asv,
      String(row.valence_raw_value), String(row.arousal_raw_value), vc, ac]);
    const old = bySong.get(song), otherSong = bySpotify.get(row.spotify_id);
    if (old && old.fingerprint !== fingerprint) fail('Conflicting rows for the same song; resolve upstream');
    if (otherSong !== undefined && otherSong !== song) fail('Spotify ID maps to multiple canonical songs');
    if (old) { duplicates++; continue; }
    bySong.set(song, { row, id: song, v, a, fingerprint }); bySpotify.set(row.spotify_id, song);
  }
  return { candidates: [...bySong.values()].filter(c => !opts.excluded.has(c.id)), duplicates };
}
function search(prepared: Prepared, selected: RecommendationView, opts: Options): RecommendationResult {
  const base = { view: selected, availableCandidates: prepared.candidates.length, duplicateRowsIgnored: prepared.duplicates };
  if (opts.limit === 0) return { ...base, tracks: [], steps: [], reason: 'zero-limit' };
  if (!prepared.candidates.length) return { ...base, tracks: [], steps: [], reason: 'no-candidates' };
  const scored = prepared.candidates.map(c => {
    const distanceSquared = opts.vw * (c.v - opts.v) ** 2 + opts.aw * (c.a - opts.a) ** 2;
    return { row: c.row, distanceSquared, distance: Math.sqrt(distanceSquared) };
  }).sort((a, b) => a.distanceSquared - b.distanceSquared ||
    (a.row.spotify_id < b.row.spotify_id ? -1 : a.row.spotify_id > b.row.spotify_id ? 1 : 0));
  const steps: RadiusStep[] = [];
  let radius = opts.initial, count = 0;
  for (;;) {
    while (count < scored.length && scored[count]!.distance <= radius) count++;
    steps.push({ radius, cumulativeCount: count });
    if (count >= opts.limit || radius === opts.max) break;
    // Zero radius advances; tiny radii or growth close to 1 cannot create an unbounded loop.
    radius = steps.length >= 63 ? opts.max : Math.min(opts.max,
      radius === 0 ? Math.max(opts.max / 1024, Number.MIN_VALUE) : radius * opts.growth);
  }
  return { ...base, tracks: scored.slice(0, Math.min(count, opts.limit)), steps,
    reason: count >= opts.limit ? 'limit-reached' : 'radius-cap-reached' };
}

export function recommend(rows: readonly RecommendationViewRow[], request: RecommendationRequest): RecommendationResult {
  const opts = options(request), selected = view(request.view);
  return search(prepare(rows, selected, opts), selected, opts);
}

/** Compare A/B1/B2/C1/C2 over exactly the same canonical song intersection. */
export function compareViews(
  inputs: Readonly<Record<RecommendationView, readonly RecommendationViewRow[]>>,
  request: Omit<RecommendationRequest, 'view'>,
): ViewComparison {
  if (inputs === null || typeof inputs !== 'object') fail('Missing VIEW inputs');
  const opts = options({ ...request, view: 'A' });
  const prepared = {} as Record<RecommendationView, Prepared>;
  const coverage = {} as Record<RecommendationView, number>;
  const identities = new Map<string, string>(), spotifyIdentities = new Map<string, string>();
  for (const selected of VIEWS) {
    const p = prepare(inputs[selected], selected, opts);
    prepared[selected] = p; coverage[selected] = p.candidates.length;
    for (const c of p.candidates) {
      if ((identities.has(c.id) && identities.get(c.id) !== c.row.spotify_id) ||
          (spotifyIdentities.has(c.row.spotify_id) && spotifyIdentities.get(c.row.spotify_id) !== c.id)) {
        fail('Canonical song identity differs between VIEWs');
      }
      identities.set(c.id, c.row.spotify_id); spotifyIdentities.set(c.row.spotify_id, c.id);
    }
  }
  const identitySets = VIEWS.map(selected => new Set(prepared[selected].candidates.map(c => c.id)));
  const common = prepared.A.candidates.filter(c => identitySets.every(ids => ids.has(c.id)));
  common.sort((a, b) => a.row.spotify_id < b.row.spotify_id ? -1 : a.row.spotify_id > b.row.spotify_id ? 1 : 0);
  const commonSongIds = common.map(c => c.id), shared = new Set(commonSongIds);
  const results = {} as Record<RecommendationView, RecommendationResult>;
  for (const selected of VIEWS) {
    results[selected] = search({ ...prepared[selected],
      candidates: prepared[selected].candidates.filter(c => shared.has(c.id)) }, selected, opts);
  }
  return { commonSongIds, coverage, results };
}

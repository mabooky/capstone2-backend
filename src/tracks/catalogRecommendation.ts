import { CatalogRequestError } from './catalogRequestError.js';
import type { Track } from './track.js';

/** Product model A only. Track.arousal is normalized ReccoBeats Energy. */
export type CatalogRequest =
    | { mode: 'seeds'; spotifyIds: string[]; n: number }
    | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; n: number };
export type CatalogResult = {
    tracks: Track[];
    status: 'complete' | 'insufficient-candidates' | 'empty';
    candidateCount: number;
};
type Point = { valence: number; arousal: number };
const BUFFER = 0.1;
// Absolute tolerance in normalized coordinates for floating point boundary calculations.
const EPS = 1e-12;
function invalid(message: string): never { throw new CatalogRequestError(message); }
function coordinate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}
export function hasValidCoordinates(point: Point): boolean {
    return coordinate(point.valence) && coordinate(point.arousal);
}

/** Validate at the runtime boundary, including internal callers. Never coerce or clamp. */
export function parseCatalogRequest(value: unknown): CatalogRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('영역 설정 객체가 필요합니다.');
    const r = value as Record<string, unknown>;
    if (!Number.isInteger(r.n) || (r.n as number) < 1 || (r.n as number) > 100) invalid('n은 1~100 정수여야 합니다.');
    const n = r.n as number;
    if (r.mode === 'seeds') {
        if (Object.keys(r).some(key => !['mode', 'spotifyIds', 'n'].includes(key))) invalid('지원하지 않는 영역 입력 필드입니다.');
        if (!Array.isArray(r.spotifyIds) || r.spotifyIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(id)))
            invalid('spotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
        const spotifyIds = [...new Set(r.spotifyIds as string[])];
        if (spotifyIds.length < 3) invalid('서로 다른 기준곡이 3곡 이상 필요합니다.');
        if (spotifyIds.length > n) invalid('기준곡 수는 n을 초과할 수 없습니다.');
        return { mode: 'seeds', spotifyIds, n };
    }
    if (r.mode === 'range') {
        if (Object.keys(r).some(key => !['mode', 'valenceMin', 'valenceMax', 'energyMin', 'energyMax', 'n'].includes(key)))
            invalid('지원하지 않는 영역 입력 필드입니다.');
        const { valenceMin, valenceMax, energyMin, energyMax } = r;
        if (!coordinate(valenceMin) || !coordinate(valenceMax) || !coordinate(energyMin) || !coordinate(energyMax))
            invalid('Valence/Energy 범위는 -1~1 유한 숫자여야 합니다.');
        if (valenceMin > valenceMax || energyMin > energyMax) invalid('최솟값은 최댓값보다 클 수 없습니다.');
        return { mode: 'range', valenceMin, valenceMax, energyMin, energyMax, n };
    }
    return invalid('mode는 seeds 또는 range여야 합니다.');
}

function cross(a: Point, b: Point, c: Point): number {
    return (b.valence - a.valence) * (c.arousal - a.arousal) - (b.arousal - a.arousal) * (c.valence - a.valence);
}
/** Monotone chain; collinear inputs reduce to endpoints, identical inputs to one point. */
function hull(points: Point[]): Point[] {
    const unique = [...new Map(points.map(p => [`${p.valence},${p.arousal}`, p])).values()]
        .sort((a, b) => a.valence - b.valence || a.arousal - b.arousal);
    if (unique.length <= 1) return unique;
    const lower: Point[] = [], upper: Point[] = [];
    for (const p of unique) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }
    for (const p of [...unique].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}
function segmentDistance(p: Point, a: Point, b: Point): number {
    const dx = b.valence - a.valence, dy = b.arousal - a.arousal;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
        ((p.valence - a.valence) * dx + (p.arousal - a.arousal) * dy) / lengthSquared));
    return Math.hypot(p.valence - a.valence - t * dx, p.arousal - a.arousal - t * dy);
}
function inBufferedHull(p: Point, polygon: Point[]): boolean {
    if (polygon.length >= 3 && polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= 0)) return true;
    return polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) <= BUFFER + EPS);
}
function shuffle<T>(values: T[], random: () => number): T[] {
    for (let i = values.length - 1; i > 0; i--) {
        const r = random();
        if (!Number.isFinite(r) || r < 0 || r >= 1) throw new Error('Random source must return a number in [0, 1).');
        const j = Math.floor(r * (i + 1));
        [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
}

/** Input is the library's prevalidated, ID-unique recommendation snapshot. No DB access.
 * Uniform sampling without replacement, followed by a uniform result shuffle. */
export function recommendCatalog(library: readonly Track[], input: CatalogRequest, random: () => number = Math.random): CatalogResult {
    const request = parseCatalogRequest(input);
    const seeds: Track[] = request.mode === 'seeds' ? request.spotifyIds.map(id => {
        const track = library.find(track => track.spotifyId === id);
        if (!track || !hasValidCoordinates(track)) throw new CatalogRequestError('기준곡이 없거나 유효한 감정 좌표가 없습니다.');
        return track;
    }) : [];
    const polygon = hull(seeds);
    const candidates = library.filter(p => request.mode === 'range'
        ? p.valence >= request.valenceMin - EPS && p.valence <= request.valenceMax + EPS &&
          p.arousal >= request.energyMin - EPS && p.arousal <= request.energyMax + EPS
        : inBufferedHull(p, polygon));
    const seedIds = new Set(seeds.map(t => t.spotifyId));
    const others = shuffle(candidates.filter(t => !seedIds.has(t.spotifyId)), random).slice(0, request.n - seeds.length);
    const tracks = shuffle([...seeds, ...others], random);
    return { tracks, candidateCount: candidates.length,
        status: tracks.length === 0 ? 'empty' : tracks.length < request.n ? 'insufficient-candidates' : 'complete' };
}

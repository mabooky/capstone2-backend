import { murmur3 } from '../murmur3.js';
import { CatalogConfigError } from './catalogConfigError.js';
import type { Track } from './track.js';

/**
 * Product model A only. Track.arousal is normalized ReccoBeats Energy.
 * randomSeed는 클라이언트가 정하는 0 이상 2^32 미만의 정수이며, 같은 요청은 항상 같은 카탈로그를 만듭니다.
 */
export type CatalogConfig =
    | { mode: 'seeds'; spotifyIds: string[]; n: number; randomSeed: number }
    | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; n: number; randomSeed: number };
export type CatalogResult = {
    tracks: Track[];
    status: 'complete' | 'insufficient-candidates' | 'empty';
    candidateCount: number;
};
type Point = { valence: number; arousal: number };
const BUFFER = 0.1;
// Absolute tolerance in normalized coordinates for floating point boundary calculations.
const EPS = 1e-12;
function invalid(message: string): never { throw new CatalogConfigError(message); }
function coordinate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}
export function hasValidCoordinates(point: Point): boolean {
    return coordinate(point.valence) && coordinate(point.arousal);
}

/** Validate at the runtime boundary, including internal callers. Never coerce or clamp. */
export function parseCatalogConfig(value: unknown): CatalogConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('영역 설정 객체가 필요합니다.');
    const r = value as Record<string, unknown>;
    if (!Number.isInteger(r.n) || (r.n as number) < 1 || (r.n as number) > 100) invalid('n은 1~100 정수여야 합니다.');
    const n = r.n as number;
    if (!Number.isInteger(r.randomSeed) || (r.randomSeed as number) < 0 || (r.randomSeed as number) >= 2 ** 32)
        invalid('randomSeed는 0 이상 2^32 미만의 정수여야 합니다.');
    const randomSeed = r.randomSeed as number;
    if (r.mode === 'seeds') {
        if (Object.keys(r).some(key => !['mode', 'spotifyIds', 'n', 'randomSeed'].includes(key))) invalid('지원하지 않는 영역 입력 필드입니다.');
        if (!Array.isArray(r.spotifyIds) || r.spotifyIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(id)))
            invalid('spotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
        const spotifyIds = [...new Set(r.spotifyIds as string[])];
        if (spotifyIds.length < 3) invalid('서로 다른 기준곡이 3곡 이상 필요합니다.');
        if (spotifyIds.length > n) invalid('기준곡 수는 n을 초과할 수 없습니다.');
        return { mode: 'seeds', spotifyIds, n, randomSeed };
    }
    if (r.mode === 'range') {
        if (Object.keys(r).some(key => !['mode', 'valenceMin', 'valenceMax', 'energyMin', 'energyMax', 'n', 'randomSeed'].includes(key)))
            invalid('지원하지 않는 영역 입력 필드입니다.');
        const { valenceMin, valenceMax, energyMin, energyMax } = r;
        if (!coordinate(valenceMin) || !coordinate(valenceMax) || !coordinate(energyMin) || !coordinate(energyMax))
            invalid('Valence/Energy 범위는 -1~1 유한 숫자여야 합니다.');
        if (valenceMin > valenceMax || energyMin > energyMax) invalid('최솟값은 최댓값보다 클 수 없습니다.');
        return { mode: 'range', valenceMin, valenceMax, energyMin, energyMax, n, randomSeed };
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
/** 곡마다 randomSeed와 곡 ID로 점수(32비트 해시)를 매겨 낮은 순으로 정렬합니다. 점수가 같으면 곡 ID순입니다. 곡의 입력 순서와 무관합니다. */
function rankByScore(tracks: readonly Track[], randomSeed: number): Track[] {
    return tracks
        .map(track => ({ track, score: murmur3(track.id, randomSeed) }))
        .sort((a, b) => a.score - b.score || (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0))
        .map(entry => entry.track);
}

/** Input is the library's prevalidated, ID-unique recommendation snapshot. No DB access.
 * 후보를 randomSeed로 정한 점수순으로 정렬해 앞의 곡을 뽑으므로, 같은 입력은 항상 같은 결과입니다. */
export function recommendCatalog(library: readonly Track[], input: CatalogConfig): CatalogResult {
    const config = parseCatalogConfig(input);
    const seeds: Track[] = config.mode === 'seeds'
        ? config.spotifyIds.map(id => {
            const track = library.find(track => track.id === id);
            if (!track || !hasValidCoordinates(track)) throw new CatalogConfigError('기준곡이 없거나 유효한 감정 좌표가 없습니다.');
            return track;
        }) 
        : [];
    const polygon = hull(seeds);
    const candidates = library.filter(p => config.mode === 'range'
        ? p.valence >= config.valenceMin - EPS && p.valence <= config.valenceMax + EPS &&
          p.arousal >= config.energyMin - EPS && p.arousal <= config.energyMax + EPS
        : inBufferedHull(p, polygon));
    const seedIds = new Set(seeds.map(t => t.id));
    const others = rankByScore(candidates.filter(t => !seedIds.has(t.id)), config.randomSeed).slice(0, config.n - seeds.length);
    const tracks = rankByScore([...seeds, ...others], config.randomSeed);
    return {
        tracks, candidateCount: candidates.length,
        status: tracks.length === 0 ? 'empty' : tracks.length < config.n ? 'insufficient-candidates' : 'complete'
    };
}

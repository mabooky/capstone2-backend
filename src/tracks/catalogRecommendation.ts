import { murmur3 } from '../murmur3.js';
import { CatalogConfigError } from './catalogConfigError.js';
import type { Track } from './track.js';

/**
 * 점주가 설정하는 카탈로그 생성 조건입니다. 곡의 arousal 값은 정규화한 ReccoBeats Energy입니다.
 * randomSeed는 클라이언트가 정하는 0 이상 2^32 미만의 정수이며, 같은 설정은 항상 같은 카탈로그를 만듭니다.
 */
export type CatalogConfig =
    | { mode: 'seeds'; seedTrackSpotifyIds: string[]; n: number; randomSeed: number }
    | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; n: number; randomSeed: number };

/**
 * CatalogConfig의 곡 ID를 곡 객체로 펼친 것입니다. GET /catalog/config가 이 형식으로 응답합니다.
 * 기준곡 방식의 seedTrackSpotifyIds가 같은 순서의 seedTracks로 바뀌는 것 말고는 CatalogConfig와 같습니다.
 */
export type ExpandedCatalogConfig =
    | { mode: 'seeds'; seedTracks: Track[]; n: number; randomSeed: number }
    | Extract<CatalogConfig, { mode: 'range' }>;

/** 카탈로그를 만든 결과입니다. candidateCount는 기준곡을 포함한 영역 안의 고유 후보 곡 수입니다. */
export type CatalogResult = {
    tracks: Track[];
    status: 'complete' | 'insufficient-candidates' | 'empty';
    candidateCount: number;
};

type Point = { valence: number; arousal: number };

/** 기준곡 방식에서 볼록 껍질 바깥으로 넓히는 원형 버퍼의 반지름입니다. */
const BUFFER = 0.1;

/** 경계를 계산할 때 허용하는 부동소수점 오차입니다. 정규화한 좌표 기준의 절댓값입니다. */
const EPS = 1e-12;

function invalid(message: string): never {
    throw new CatalogConfigError(message);
}

function coordinate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

export function hasValidCoordinates(point: Point): boolean {
    return coordinate(point.valence) && coordinate(point.arousal);
}

/** 외부 입력이든 내부 호출이든 실행 시점에 설정을 검증합니다. 값을 다른 형식으로 바꾸거나 범위 안으로 끌어오지 않습니다. */
export function parseCatalogConfig(value: unknown): CatalogConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid('영역 설정 객체가 필요합니다.');
    }
    const r = value as Record<string, unknown>;

    if (!Number.isInteger(r.n) || (r.n as number) < 1 || (r.n as number) > 100) {
        invalid('n은 1~100 정수여야 합니다.');
    }
    const n = r.n as number;

    if (!Number.isInteger(r.randomSeed) || (r.randomSeed as number) < 0 || (r.randomSeed as number) >= 2 ** 32) {
        invalid('randomSeed는 0 이상 2^32 미만의 정수여야 합니다.');
    }
    const randomSeed = r.randomSeed as number;

    if (r.mode === 'seeds') {
        if (Object.keys(r).some(key => !['mode', 'seedTrackSpotifyIds', 'n', 'randomSeed'].includes(key))) {
            invalid('지원하지 않는 영역 입력 필드입니다.');
        }
        if (!Array.isArray(r.seedTrackSpotifyIds) || r.seedTrackSpotifyIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9]{22}$/.test(id))) {
            invalid('seedTrackSpotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
        }
        const seedTrackSpotifyIds = [...new Set(r.seedTrackSpotifyIds as string[])];
        if (seedTrackSpotifyIds.length < 3) invalid('서로 다른 기준곡이 3곡 이상 필요합니다.');
        if (seedTrackSpotifyIds.length > n) invalid('기준곡 수는 n을 초과할 수 없습니다.');
        return { mode: 'seeds', seedTrackSpotifyIds, n, randomSeed };
    }

    if (r.mode === 'range') {
        if (Object.keys(r).some(key => !['mode', 'valenceMin', 'valenceMax', 'energyMin', 'energyMax', 'n', 'randomSeed'].includes(key))) {
            invalid('지원하지 않는 영역 입력 필드입니다.');
        }
        const { valenceMin, valenceMax, energyMin, energyMax } = r;
        if (!coordinate(valenceMin) || !coordinate(valenceMax) || !coordinate(energyMin) || !coordinate(energyMax)) {
            invalid('Valence/Energy 범위는 -1~1 유한 숫자여야 합니다.');
        }
        if (valenceMin > valenceMax || energyMin > energyMax) invalid('최솟값은 최댓값보다 클 수 없습니다.');
        return { mode: 'range', valenceMin, valenceMax, energyMin, energyMax, n, randomSeed };
    }

    return invalid('mode는 seeds 또는 range여야 합니다.');
}

function cross(a: Point, b: Point, c: Point): number {
    return (b.valence - a.valence) * (c.arousal - a.arousal) - (b.arousal - a.arousal) * (c.valence - a.valence);
}

/** 모노톤 체인으로 볼록 껍질을 구합니다. 한 직선 위의 점들은 양 끝점으로, 모두 같은 점은 한 점으로 줄어듭니다. */
function hull(points: Point[]): Point[] {
    const unique = [...new Map(points.map(p => [`${p.valence},${p.arousal}`, p])).values()]
        .sort((a, b) => a.valence - b.valence || a.arousal - b.arousal);
    if (unique.length <= 1) return unique;

    const lower: Point[] = [];
    for (const p of unique) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
        lower.push(p);
    }

    const upper: Point[] = [];
    for (const p of [...unique].reverse()) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
        upper.push(p);
    }

    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** 점 p와 선분 ab 사이의 최단 거리입니다. a와 b가 같으면 두 점 사이의 거리입니다. */
function segmentDistance(p: Point, a: Point, b: Point): number {
    const dx = b.valence - a.valence;
    const dy = b.arousal - a.arousal;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.valence - a.valence) * dx + (p.arousal - a.arousal) * dy) / lengthSquared));
    return Math.hypot(p.valence - a.valence - t * dx, p.arousal - a.arousal - t * dy);
}

/** 점 p가 볼록 껍질 안에 있거나, 껍질의 변에서 BUFFER 거리 안에 있는지 확인합니다. */
function inBufferedHull(p: Point, polygon: Point[]): boolean {
    if (polygon.length >= 3 && polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], p) >= 0)) return true;
    return polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) <= BUFFER + EPS);
}

/** 곡마다 randomSeed와 곡 ID로 점수(32비트 해시)를 매겨 낮은 순으로 정렬합니다. 점수가 같으면 곡 ID순이며, 곡의 입력 순서와 무관합니다. */
function rankByScore(tracks: readonly Track[], randomSeed: number): Track[] {
    return tracks
        .map(track => ({ track, score: murmur3(track.id, randomSeed) }))
        .sort((a, b) => a.score - b.score || (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0))
        .map(entry => entry.track);
}

/**
 * 설정에 따라 카탈로그를 만듭니다. library는 곡 라이브러리가 미리 검증하고 ID 중복을 없앤 추천용 곡 목록이며, DB에는 접근하지 않습니다.
 * 후보를 randomSeed로 정한 점수순으로 정렬해 앞의 곡을 뽑으므로, 같은 입력은 항상 같은 결과입니다.
 */
export function recommendCatalog(library: readonly Track[], input: CatalogConfig): CatalogResult {
    const config = parseCatalogConfig(input);

    const seeds: Track[] = config.mode === 'seeds'
        ? config.seedTrackSpotifyIds.map(id => {
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
        tracks,
        candidateCount: candidates.length,
        status: tracks.length === 0 ? 'empty' : tracks.length < config.n ? 'insufficient-candidates' : 'complete',
    };
}

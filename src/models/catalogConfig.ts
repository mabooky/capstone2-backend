import type { Track } from '../tracks/track.js';

/** 카탈로그 설정의 내용이 잘못되었을 때 던지는 오류입니다. 값이 유효하지 않거나 기준곡을 찾을 수 없는 경우를 포함합니다. */
export class CatalogConfigError extends Error {}

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

/** 값이 [-1, 1] 범위의 유한한 숫자인지 확인합니다. */
export function isValidCoordinate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

function invalid(message: string): never {
    throw new CatalogConfigError(message);
}

/**
 * 값이 카탈로그 설정의 형식에 맞는지 검증하고 CatalogConfig로 돌려줍니다. 맞지 않으면 CatalogConfigError를 던집니다.
 * 값을 다른 형식으로 바꾸거나 범위 안으로 끌어오지 않으며, 기준곡 ID 같은 곡이 실제로 있는지는 확인하지 않습니다.
 */
export function parseCatalogConfig(value: unknown): CatalogConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid('영역 설정 객체가 필요합니다.');
    }
    const r = value as Record<string, unknown>;

    if (!Number.isInteger(r.n) || (r.n as number) < 1 || (r.n as number) > 100) {
        invalid('n은 구간 [1, 100] 내의 정수여야 합니다.');
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
        if (!isValidCoordinate(valenceMin) || !isValidCoordinate(valenceMax) || !isValidCoordinate(energyMin) || !isValidCoordinate(energyMax)) {
            invalid('Valence/Energy는 [-1, 1] 내의 유한 숫자여야 합니다.');
        }
        if (valenceMin > valenceMax || energyMin > energyMax) invalid('최솟값은 최댓값보다 클 수 없습니다.');
        return { mode: 'range', valenceMin, valenceMax, energyMin, energyMax, n, randomSeed };
    }

    return invalid('mode는 seeds 또는 range여야 합니다.');
}

import type { Track } from '../tracks/track.js';
import type { Artist } from '../artists/artist.js';

/** 카탈로그 설정의 내용이 잘못되었을 때 던지는 오류입니다. 값이 유효하지 않거나 기준곡을 찾을 수 없는 경우를 포함합니다. */
export class CatalogConfigError extends Error {}

/**
 * 점주가 설정하는 카탈로그 생성 조건입니다. 곡의 arousal 값은 정규화한 ReccoBeats Energy입니다.
 * randomSeed는 클라이언트가 정하는 0 이상 2^32 미만의 정수이며, 같은 설정은 항상 같은 카탈로그를 만듭니다.
 */
export type CatalogConfig =
    | { mode: 'seeds'; seedTrackSpotifyIds: string[]; blacklist: Blacklist; n: number; randomSeed: number }
    | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; blacklist: Blacklist; n: number; randomSeed: number };

/** 카탈로그에서 제외할 곡과 아티스트입니다. 아티스트를 제외하면 그 아티스트가 참여한 곡을 모두 제외합니다. */
export type Blacklist = { trackSpotifyIds: string[]; artistSpotifyIds: string[] };

/**
 * CatalogConfig의 곡 ID와 아티스트 ID를 객체로 펼친 것입니다. GET /catalog/config가 이 형식으로 응답합니다.
 * 기준곡 방식의 seedTrackSpotifyIds가 같은 순서의 seedTracks로, blacklist가 ExpandedBlacklist로 바뀌는 것 말고는 CatalogConfig와 같습니다.
 */
export type ExpandedCatalogConfig =
    | { mode: 'seeds'; seedTracks: Track[]; blacklist: ExpandedBlacklist; n: number; randomSeed: number }
    | { mode: 'range'; valenceMin: number; valenceMax: number; energyMin: number; energyMax: number; blacklist: ExpandedBlacklist; n: number; randomSeed: number };

/** Blacklist의 ID를 같은 순서의 객체로 펼친 것입니다. */
export type ExpandedBlacklist = { tracks: Track[]; artists: Artist[] };

/** 곡 자신의 ID가 있거나 참여 아티스트 중 한 명이라도 블랙리스트에 있으면 true를 돌려주는 판정 함수를 만듭니다. */
export function compileBlacklistPredicate(blacklist: Blacklist): (track: Track) => boolean {
    const trackIds = new Set(blacklist.trackSpotifyIds);
    const artistIds = new Set(blacklist.artistSpotifyIds);
    return track => trackIds.has(track.id) || track.artistIds.some(id => artistIds.has(id));
}

/** 값이 [-1, 1] 범위의 유한한 숫자인지 확인합니다. */
export function isValidCoordinate(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= -1 && value <= 1;
}

function invalid(message: string): never {
    throw new CatalogConfigError(message);
}

/** 값이 22자리 영숫자 Spotify ID의 배열인지 확인합니다. */
function isSpotifyIdArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(id => typeof id === 'string' && /^[A-Za-z0-9]{22}$/.test(id));
}

/** 블랙리스트의 형식을 검증합니다. 두 배열의 중복은 제거합니다. */
function parseBlacklist(value: unknown): Blacklist {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalid('blacklist 객체가 필요합니다.');
    }
    const r = value as Record<string, unknown>;
    if (Object.keys(r).some(key => !['trackSpotifyIds', 'artistSpotifyIds'].includes(key))) {
        invalid('지원하지 않는 blacklist 필드입니다.');
    }
    if (!isSpotifyIdArray(r.trackSpotifyIds)) invalid('blacklist.trackSpotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
    if (!isSpotifyIdArray(r.artistSpotifyIds)) invalid('blacklist.artistSpotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
    return {
        trackSpotifyIds: [...new Set(r.trackSpotifyIds)],
        artistSpotifyIds: [...new Set(r.artistSpotifyIds)],
    };
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
    const blacklist = parseBlacklist(r.blacklist);

    if (r.mode === 'seeds') {
        if (Object.keys(r).some(key => !['mode', 'seedTrackSpotifyIds', 'blacklist', 'n', 'randomSeed'].includes(key))) {
            invalid('지원하지 않는 영역 입력 필드입니다.');
        }
        if (!isSpotifyIdArray(r.seedTrackSpotifyIds)) invalid('seedTrackSpotifyIds는 22자리 Spotify ID 배열이어야 합니다.');
        const seedTrackSpotifyIds = [...new Set(r.seedTrackSpotifyIds)];
        if (seedTrackSpotifyIds.length < 3) invalid('서로 다른 기준곡이 3곡 이상 필요합니다.');
        if (seedTrackSpotifyIds.length > n) invalid('기준곡 수는 n을 초과할 수 없습니다.');
        return { mode: 'seeds', seedTrackSpotifyIds, blacklist, n, randomSeed };
    }

    if (r.mode === 'range') {
        if (Object.keys(r).some(key => !['mode', 'valenceMin', 'valenceMax', 'energyMin', 'energyMax', 'blacklist', 'n', 'randomSeed'].includes(key))) {
            invalid('지원하지 않는 영역 입력 필드입니다.');
        }
        const { valenceMin, valenceMax, energyMin, energyMax } = r;
        if (!isValidCoordinate(valenceMin) || !isValidCoordinate(valenceMax) || !isValidCoordinate(energyMin) || !isValidCoordinate(energyMax)) {
            invalid('Valence/Energy는 [-1, 1] 내의 유한 숫자여야 합니다.');
        }
        if (valenceMin > valenceMax || energyMin > energyMax) invalid('최솟값은 최댓값보다 클 수 없습니다.');
        return { mode: 'range', valenceMin, valenceMax, energyMin, energyMax, blacklist, n, randomSeed };
    }

    return invalid('mode는 seeds 또는 range여야 합니다.');
}

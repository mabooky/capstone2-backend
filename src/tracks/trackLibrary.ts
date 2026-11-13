import type { Track } from './track.js';
import type { TrackRow } from '../db/trackRepository.js';
import { hasValidCoordinates, recommendCatalog, type CatalogRequest, type CatalogResult } from './catalogRecommendation.js';

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. */
export interface TrackLibrary {
    /** 전체 곡 수입니다. */
    readonly size: number;
    recommend(input: CatalogRequest, random?: () => number): CatalogResult;
    get(spotifyId: string): Track | undefined;
    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] };
}

/** Pure in-memory snapshot built from tracks_v3 rows; never opens a database. */
export function createTrackLibraryFrom(rows: readonly TrackRow[]): TrackLibrary {
    // [0, 1] 값을 [-1, 1]로 바꿉니다. 범위를 벗어나거나 숫자가 아니면 NaN입니다.
    // createTrackLibraryFrom은 시작할 때 한 번만 호출되므로 이 함수를 안에 두어도 비용이 없습니다.
    function normalize(value: unknown): number {
        if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return Number.NaN;
        const raw = Number(value);
        return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? 2 * raw - 1 : Number.NaN;
    }

    // 추천 후보와 검색 결과의 순서를 DB의 문자 정렬 규칙과 무관하게 고정하려고, Spotify ID를 단순 비교로 정렬합니다.
    const tracks: Track[] = [...rows]
        .sort((a, b) => (a.spotify_id < b.spotify_id ? -1 : a.spotify_id > b.spotify_id ? 1 : 0))
        .map(row => ({
            spotifyId: row.spotify_id,
            title: row.title,
            artist: row.artist,
            duration: row.duration_ms,
            albumImageUrl: '',
            // tracks_v3는 [0, 1] 원본 값을 저장하므로, 이 프로젝트의 좌표계 [-1, 1]로 여기서 한 번만 바꿉니다.
            valence: normalize(row.valence),
            arousal: normalize(row.energy),
        }));
    const byId = new Map(tracks.map(track => [track.spotifyId, track]));
    // 추천은 ID별 첫 유효 행을 사용합니다. 전체 곡 조회용 byId의 마지막 행 정책과 구분합니다.
    const recommendationIds = new Set<string>();
    const recommendationTracks = tracks.filter(track => {
        if (!hasValidCoordinates(track) || recommendationIds.has(track.spotifyId)) return false;
        recommendationIds.add(track.spotifyId);
        return true;
    });
    const searchTexts = tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());

    return {
        size: tracks.length,

        recommend(input: CatalogRequest, random?: () => number): CatalogResult {
            return recommendCatalog(recommendationTracks, input, random);
        },

        get(spotifyId: string): Track | undefined {
            return byId.get(spotifyId);
        },

        search(query: string, limit: number, offset: number): { total: number; tracks: Track[] } {
            const needle = query.trim().toLowerCase();
            if (needle === '') return { total: 0, tracks: [] };
            const startsWithNeedle: Track[] = [];
            const containsNeedle: Track[] = [];
            for (let i = 0; i < tracks.length; i++) {
                if (!searchTexts[i].includes(needle)) continue;
                const track = tracks[i];
                const isPrefix = track.title.toLowerCase().startsWith(needle) || track.artist.toLowerCase().startsWith(needle);
                (isPrefix ? startsWithNeedle : containsNeedle).push(track);
            }
            const matches = startsWithNeedle.concat(containsNeedle);
            return { total: matches.length, tracks: matches.slice(offset, offset + limit) };
        },
    };
}

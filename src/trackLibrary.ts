import type { Track } from './models/track.js';
import type { TrackRow } from './db/trackRepository.js';
import { hasValidCoordinates, recommendCatalog, type CatalogRequest, type CatalogResult } from './catalogRecommendation.js';

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. */
export interface TrackLibrary {
    /** 전체 곡 수입니다. */
    readonly size: number;
    recommend(input: CatalogRequest, random?: () => number): CatalogResult;
    get(spotifyId: string): Track | undefined;
    /** 기준점에서 가까운 순서로 n곡을 돌려줍니다. 기존 단일 기준점 API 호환 경로입니다. */
    nearest(valence: number, arousal: number, n: number): Track[];
    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] };
}

/** Pure in-memory snapshot built from tracks_v3 rows; never opens a database. */
export function createTrackLibrary(rows: readonly TrackRow[]): TrackLibrary {
    // [0, 1] 값을 [-1, 1]로 바꿉니다. 범위를 벗어나거나 숫자가 아니면 NaN입니다.
    // createTrackLibrary는 시작할 때 한 번만 호출되므로 이 함수를 안에 두어도 비용이 없습니다.
    function normalize(value: unknown): number {
        if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return Number.NaN;
        const raw = Number(value);
        return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? 2 * raw - 1 : Number.NaN;
    }

    // 거리가 같은 곡의 순서를 DB의 문자 정렬 규칙과 무관하게 정하려고, Spotify ID를 단순 비교로 정렬합니다.
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
    const valences = Float64Array.from(tracks, track => track.valence);
    const arousals = Float64Array.from(tracks, track => track.arousal);
    const searchTexts = tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());

    return {
        size: tracks.length,

        recommend(input: CatalogRequest, random?: () => number): CatalogResult {
            return recommendCatalog(tracks, input, random);
        },

        get(spotifyId: string): Track | undefined {
            return byId.get(spotifyId);
        },

        nearest(valence: number, arousal: number, n: number): Track[] {
            const distances = new Float64Array(tracks.length);
            for (let i = 0; i < tracks.length; i++) {
                const dv = valences[i] - valence;
                const da = arousals[i] - arousal;
                distances[i] = dv * dv + da * da;
            }
            // 정렬은 안정 정렬이므로, 거리가 같으면 위에서 정렬해 둔 Spotify ID 순서가 유지됩니다.
            const order = Array.from(tracks.keys()).filter(i => hasValidCoordinates(tracks[i])).sort((a, b) => distances[a] - distances[b]);
            return order.slice(0, Math.max(0, n)).map(index => tracks[index]);
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

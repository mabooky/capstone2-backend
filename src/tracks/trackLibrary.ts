import type { Track } from './track.js';
import type { TrackRow } from '../db/trackRepository.js';
import { hasValidCoordinates, recommendCatalog, type CatalogResult } from './catalogRecommendation.js';
import type { CatalogConfig } from '../models/catalogConfig.js';

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. */
export interface TrackLibrary {
    /** 전체 곡 수입니다. */
    readonly size: number;
    recommend(input: CatalogConfig): CatalogResult;
    get(id: string): Track | undefined;
    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] };
}

/** Pure in-memory snapshot built from tracks_v4 rows; never opens a database. */
export function createTrackLibraryFrom(rows: readonly TrackRow[]): TrackLibrary {
    const tracks: Track[] = [...rows]
        .map(row => ({
            id: row.spotify_id,
            title: row.title,
            artist: row.artist,
            artistIds: row.artist_spotify_ids,
            duration: row.duration_ms,
            playCount: Number(row.play_count),
            albumId: row.album_id,
            albumThumbUrl: row.album_thumb_url,
            valence: row.valence,
            arousal: row.arousal,
        }))
        // DB가 돌려주는 행 순서는 보장되지 않으므로 먼저 ID로 정렬
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const byId = new Map(tracks.map(track => [track.id, track]));
    // 추천은 ID별 첫 유효 행을 사용합니다. 전체 곡 조회용 byId의 마지막 행 정책과 구분합니다.
    const recommendationIds = new Set<string>();
    const recommendationTracks = tracks.filter(track => {
        if (!hasValidCoordinates(track) || recommendationIds.has(track.id)) return false;
        recommendationIds.add(track.id);
        return true;
    });
    const searchTexts = tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());

    return {
        size: tracks.length,

        recommend(input: CatalogConfig): CatalogResult {
            return recommendCatalog(recommendationTracks, input);
        },

        get(id: string): Track | undefined {
            return byId.get(id);
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

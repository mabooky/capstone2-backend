import type { Track } from './track.js';
import type { TrackRow } from '../db/trackRepository.js';
import { isValidCoordinate } from '../models/catalogConfig.js';

/** 전체 곡을 메모리에 올려 두고 조회하는 도구입니다. 매장과 무관한 곡 데이터만 다룹니다. */
export interface TrackLibrary {
    /** 전체 곡입니다. ID순으로 정렬되어 있습니다. */
    readonly tracks: readonly Track[];
    get(id: string): Track | undefined;
    /** 제목과 아티스트에서 검색어를 찾습니다. 검색어로 시작하는 곡을 먼저 돌려줍니다. */
    search(query: string, limit: number, offset: number): { total: number; tracks: Track[] };
}

/**
 * tracks_v4의 행으로 메모리 곡 라이브러리를 만듭니다. DB에는 접속하지 않습니다.
 * 좌표가 [-1, 1] 범위의 유한한 숫자가 아니거나 ID가 겹치는 행이 있으면 오류를 던집니다.
 * tracks_v4의 제약상 생길 수 없는 경우이므로, 생겼다면 곡 데이터를 잘못 올린 것입니다.
 */
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
        // DB가 돌려주는 행 순서는 보장되지 않으므로 먼저 ID로 정렬합니다.
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    const byId = new Map<string, Track>();
    for (const track of tracks) {
        if (!isValidCoordinate(track.valence) || !isValidCoordinate(track.arousal)) {
            throw new Error(`곡(${track.id})의 감정 좌표가 올바르지 않습니다.`);
        }
        if (byId.has(track.id)) {
            throw new Error(`곡 ID(${track.id})가 중복되었습니다.`);
        }
        byId.set(track.id, track);
    }

    const searchTexts = tracks.map(track => `${track.title}\n${track.artist}`.toLowerCase());

    return {
        tracks,

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

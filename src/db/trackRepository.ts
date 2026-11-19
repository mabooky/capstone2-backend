import { pool } from './connectionPool.js';

/** tracks_v4 테이블에서 읽는 한 줄입니다. valence와 arousal은 이미 정규화된 값([-1, 1])입니다. */
export interface TrackRow {
    spotify_id: string;
    title: string;
    artist: string;
    artist_spotify_ids: string[];
    duration_ms: number;
    play_count: string; // pg는 bigint를 문자열로 돌려줌
    album_id: string;
    album_thumb_url: string | null;
    valence: number;
    arousal: number;
}

/**
 * tracks_v4의 모든 곡을 읽어옵니다. valence와 arousal은 이미 정규화된 값([-1, 1])입니다.
 */
export async function findAllTracks(): Promise<TrackRow[]> {
    try {
        const result = await pool.query<TrackRow>('SELECT spotify_id, title, artist, artist_spotify_ids, duration_ms, play_count, album_id, album_thumb_url, valence, arousal FROM tracks_v4');
        return result.rows;
    } catch (error) {
        throw new Error('곡 데이터를 불러오지 못했습니다.', { cause: error });
    }
}

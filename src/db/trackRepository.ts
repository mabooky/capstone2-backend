import { pool } from './connectionPool.js';

/** tracks_v3 테이블에서 읽는 한 줄입니다. valence와 energy는 ReccoBeats 원본 값([0, 1])입니다. */
export interface TrackRow {
    spotify_id: string;
    title: string;
    artist: string;
    duration_ms: number;
    valence: number;
    energy: number;
}

/**
 * tracks_v3의 모든 곡을 읽습니다. 한국 재생 불가 곡(kr_available = false)도 걸러내지 않습니다.
 * valence와 energy는 DB에 저장된 원본 값([0, 1])입니다.
 */
export async function findAllTracks(): Promise<TrackRow[]> {
    try {
        const result = await pool.query<TrackRow>('SELECT spotify_id, title, artist, duration_ms, valence, energy FROM tracks_v3');
        return result.rows;
    } catch (error) {
        throw new Error('곡 데이터를 불러오지 못했습니다.', { cause: error });
    }
}

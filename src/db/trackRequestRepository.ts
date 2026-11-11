import { pool } from './connectionPool.js';

/** 곡 신청 이력에 한 건을 추가합니다. */
export async function insertTrackRequest(userId: string, storeId: string, spotifyId: string): Promise<void> {
    await pool.query('INSERT INTO track_requests (user_id, store_id, spotify_id) VALUES ($1, $2, $3)', [userId, storeId, spotifyId]);
}

import { pool } from './connectionPool.js';

/** 곡 신청 이력에 한 건을 추가합니다. */
export async function insertTrackRequest(userId: string, storeId: string, spotifyId: string): Promise<void> {
    await pool.query('INSERT INTO track_requests (user_id, store_id, spotify_id) VALUES ($1, $2, $3)', [userId, storeId, spotifyId]);
}

export interface TrackRequestRow {
    id: string;
    store_id: string;
    store_name: string;
    spotify_id: string;
    requested_at: Date;
}

export interface TrackRequestQuery {
    /** 지정하면 이 매장의 신청만 조회합니다. */
    storeId?: string;
    limit: number;
    offset: number;
}

/** 사용자의 신청 이력을 최신순으로 읽습니다. 매장 이름도 함께 가져옵니다. */
export async function findTrackRequestsByUser(userId: string, { storeId, limit, offset }: TrackRequestQuery): Promise<TrackRequestRow[]> {
    const result = await pool.query<TrackRequestRow>(
        `SELECT r.id, r.store_id, s.name AS store_name, r.spotify_id, r.requested_at
         FROM track_requests r
         JOIN stores s ON s.id = r.store_id
         WHERE r.user_id = $1 AND ($2::text IS NULL OR r.store_id = $2)
         ORDER BY r.requested_at DESC, r.id
         LIMIT $3 OFFSET $4`,
        [userId, storeId ?? null, limit, offset],
    );
    return result.rows;
}

/** 사용자의 신청 이력 전체 개수를 셉니다. storeId를 지정하면 그 매장의 신청만 셉니다. */
export async function countTrackRequestsByUser(userId: string, storeId?: string): Promise<number> {
    const result = await pool.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM track_requests WHERE user_id = $1 AND ($2::text IS NULL OR store_id = $2)',
        [userId, storeId ?? null],
    );
    return result.rows[0].count;
}

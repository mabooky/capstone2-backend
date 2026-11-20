import { pool } from './connectionPool.js';

/** 곡 평가입니다. 1은 추천, -1은 비추천이고, 0은 취소한 평가입니다. track_ratings의 CHECK가 이 세 값만 허용합니다. */
export type Rating = -1 | 0 | 1;

/** track_ratings 테이블에서 읽는 한 줄입니다. */
export interface TrackRatingRow {
    store_id: string;
    user_id: string;
    track_spotify_id: string;
    rating: Rating;
}

/** track_ratings의 모든 평가를 읽어옵니다. */
export async function findAllTrackRatings(): Promise<TrackRatingRow[]> {
    try {
        const result = await pool.query<TrackRatingRow>('SELECT store_id, user_id, track_spotify_id, rating FROM track_ratings');
        return result.rows;
    } catch (error) {
        throw new Error('곡 평가 데이터를 불러오지 못했습니다.', { cause: error });
    }
}

/** 평가를 저장합니다. 이미 있으면 값을 바꾸고 rated_at을 지금 시각으로 갱신합니다. */
export async function upsertTrackRating(storeId: string, userId: string, trackId: string, rating: Rating): Promise<void> {
    await pool.query(
        `INSERT INTO track_ratings (store_id, user_id, track_spotify_id, rating)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (store_id, user_id, track_spotify_id)
         DO UPDATE SET rating = EXCLUDED.rating, rated_at = now()`,
        [storeId, userId, trackId, rating],
    );
}

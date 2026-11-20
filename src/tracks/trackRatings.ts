import type { Rating, TrackRatingRow } from '../db/trackRatingRepository.js';
import { createRunExclusive } from '../runExclusive.js';

/** 고객이 매장에서 곡에 남긴 평가를 메모리에 올려 두고 조회하고 저장하는 도구입니다. 모든 매장이 하나를 공유합니다. */
export interface TrackRatings {
    /** 사용자가 이 매장에서 곡에 남긴 평가입니다. 평가한 적이 없으면 undefined이고, 취소한 평가는 0입니다. */
    get(storeId: string, userId: string, trackId: string): Rating | undefined;
    /**
     * 평가를 저장합니다. DB에 먼저 저장하고, 성공하면 메모리에 반영하므로 저장에 실패하면 메모리는 바뀌지 않습니다.
     * 같은 매장, 사용자, 곡에 대한 호출은 호출한 순서대로 하나씩 실행해서 DB와 메모리의 마지막 값이 어긋나지 않게 합니다.
     */
    set(storeId: string, userId: string, trackId: string, rating: Rating): Promise<void>;
}

/** 평가를 구분하는 키입니다. 구분자인 \0은 매장, 사용자, 곡의 ID에 들어갈 수 없는 문자입니다. */
function keyOf(storeId: string, userId: string, trackId: string): string {
    return `${storeId}\0${userId}\0${trackId}`;
}

/**
 * 읽어 둔 평가 행으로 만드는 메모리 평가 모음입니다. 직접 DB에 접속하지 않고, 저장은 받은 persist 함수에 맡깁니다.
 */
export function createTrackRatingsFrom(
    rows: readonly TrackRatingRow[],
    persist: (storeId: string, userId: string, trackId: string, rating: Rating) => Promise<void>,
): TrackRatings {
    const ratings = new Map<string, Rating>(
        rows.map(row => [keyOf(row.store_id, row.user_id, row.track_spotify_id), row.rating]),
    );
    const runExclusive = createRunExclusive();

    return {
        get(storeId: string, userId: string, trackId: string): Rating | undefined {
            return ratings.get(keyOf(storeId, userId, trackId));
        },

        set(storeId: string, userId: string, trackId: string, rating: Rating): Promise<void> {
            const key = keyOf(storeId, userId, trackId);
            return runExclusive(key, async () => {
                await persist(storeId, userId, trackId, rating);
                ratings.set(key, rating);
            });
        },
    };
}

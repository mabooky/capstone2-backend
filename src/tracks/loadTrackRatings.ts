import { findAllTrackRatings, upsertTrackRating } from '../db/trackRatingRepository.js';
import { createTrackRatingsFrom, type TrackRatings } from './trackRatings.js';

/** DB에서 곡 평가를 읽어 메모리 평가 모음을 만듭니다. 서버를 시작할 때 한 번 호출합니다. */
export async function loadTrackRatings(): Promise<TrackRatings> {
    return createTrackRatingsFrom(await findAllTrackRatings(), upsertTrackRating);
}

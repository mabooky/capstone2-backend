import type { Track } from '../tracks/track.js';

export type RequestStatus =
    | 'available'
    | 'blacklisted'
    | 'out-of-catalog'
    | 'already-queued'
    | 'now-playing'
    | 'recently-played';

/**
 * 매장 응답으로 나가는 곡입니다. 곡 자체(Track)에 매장과 사용자라는 맥락에서 정해지는 값을 붙인 것입니다.
 * requestStatus는 이 매장에서의 신청 상태(매장 기준)이고, myRating은 요청한 사용자의 평가(사용자 기준)입니다.
 * myRating은 추천인 경우 1, 비추천인 경우 -1, 취소한 경우 0, 평가한 적이 없거나 로그인하지 않았으면 null입니다.
 */
export type TrackWithContext = Track & { requestStatus: RequestStatus; myRating: -1 | 0 | 1 | null };
